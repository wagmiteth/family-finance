"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseFiles } from "@/lib/transactions/parser";
import { autoCategorizeImport } from "@/lib/transactions/categorizer";
import { encryptTransaction, encryptFields, decryptEntities, decryptEntity } from "@/lib/crypto/entity-crypto";
import { getDEK } from "@/lib/crypto/key-store";
import { generateImportHash, generateLegacyImportHash, txSignature } from "@/lib/transactions/dedup";
import { hasDEK } from "@/lib/crypto/key-store";
import { useData } from "@/lib/crypto/data-provider";
import { isDeletedCategory } from "@/lib/categories";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileUp,
  CheckCircle2,
  AlertCircle,
  FileText,
  FileJson,
  Database,
  X,
  ExternalLink,
  Download,
  Zap,
  FileSpreadsheet,
  Trash2,
  History,
  Loader2,
  ChevronDown,
  ChevronRight,
  Info,
  Copy,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type {
  ParsedTransaction,
  FileParseResult,
  AccountMetadata,
  User,
  MerchantRule,
  Category,
  FileFormat,
} from "@/lib/types";

interface UploadBatchStats {
  skipped_exact?: number;
  skipped_legacy?: number;
  total_before?: number;
  monthly_sums?: { month: string; sum: number }[];
}

interface UploadBatch {
  id: string;
  file_names?: string[];
  transaction_count: number;
  duplicate_count: number;
  source: string | null;
  created_at: string;
  user_id: string | null;
  uploaded_by: string | null;
  encrypted_data?: string | null;
  // Decrypted rich stats (stored inside encrypted_data)
  stats?: UploadBatchStats;
}

function formatCurrency(amount: number) {
  return amount.toLocaleString("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

const FORMAT_LABELS: Record<FileFormat, string> = {
  zlantar_csv: "Zlantar CSV",
  zlantar_json: "Zlantar JSON",
  zlantar_data: "Account Metadata",
  bank_csv: "Bank CSV",
  unknown: "Unknown",
};

const FORMAT_COLORS: Record<FileFormat, "default" | "secondary" | "outline" | "destructive"> = {
  zlantar_csv: "default",
  zlantar_json: "default",
  zlantar_data: "secondary",
  bank_csv: "outline",
  unknown: "destructive",
};

function FormatIcon({ format }: { format: FileFormat }) {
  switch (format) {
    case "zlantar_csv":
    case "bank_csv":
      return <FileText className="h-4 w-4" />;
    case "zlantar_json":
      return <FileJson className="h-4 w-4" />;
    case "zlantar_data":
      return <Database className="h-4 w-4" />;
    default:
      return <AlertCircle className="h-4 w-4" />;
  }
}

export default function UploadPage() {
  const router = useRouter();
  const dataCache = useData();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [fileResults, setFileResults] = useState<FileParseResult[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const merchantRulesRef = useRef<MerchantRule[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [householdId, setHouseholdId] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [dedupCheck, setDedupCheck] = useState<{
    loading: boolean;
    existingHashes: Set<string>;
    totalInDb: number;
    skippedExact: number;
    skippedLegacy: number;
    willImport: number;
    /** Set of transaction indices (within allTransactions non-dup list) that are new */
    newIndices: Set<number>;
  } | null>(null);

  // Derived state — memoize to keep stable references
  const allTransactions = useMemo(() => fileResults.flatMap((r) => r.transactions), [fileResults]);
  const allAccounts = useMemo(() => fileResults.flatMap((r) => r.accounts), [fileResults]);
  const uniqueAccounts = allAccounts.filter(
    (acc, i, arr) =>
      arr.findIndex(
        (a) =>
          a.bank_name === acc.bank_name &&
          a.account_name === acc.account_name
      ) === i
  );
  const hasMetadata = fileResults.some((r) => r.format === "zlantar_data");
  const newCount = allTransactions.filter((t) => !t.isDuplicate).length;
  const dupCount = allTransactions.filter((t) => t.isDuplicate).length;
  const autoCatCount = allTransactions.filter((t) => t.autoCategory).length;
  const categoryMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) {
      if (!isDeletedCategory(c)) {
        m.set(c.id, c.display_name || c.name);
      }
    }
    return m;
  }, [categories]);

  // Pre-import stats: occurrence counts, monthly sums, date range, account breakdown
  const preImportStats = useMemo(() => {
    const txs = allTransactions.filter((t) => !t.isDuplicate);
    if (txs.length === 0) return null;

    // Count occurrences to detect within-file collisions
    const sigCounts = new Map<string, number>();
    for (const t of txs) {
      const sig = txSignature(t.date, t.amount, t.description || "", t.account_number);
      sigCounts.set(sig, (sigCounts.get(sig) || 0) + 1);
    }
    const sameHashCount = [...sigCounts.values()].reduce((s, c) => s + (c > 1 ? c : 0), 0);
    const sameHashGroups = [...sigCounts.values()].filter((c) => c > 1).length;

    // Monthly sums for the 2 most recent months relative to now
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
    const targetMonths = new Set([currentMonth, prevMonth]);

    const monthlySums = new Map<string, number>();
    for (const t of txs) {
      const txMonth = t.date.slice(0, 7);
      if (targetMonths.has(txMonth)) {
        monthlySums.set(txMonth, (monthlySums.get(txMonth) || 0) + t.amount);
      }
    }
    const monthlySumsArr = [...monthlySums.entries()]
      .map(([month, sum]) => ({ month, sum: Math.round(sum * 100) / 100 }))
      .sort((a, b) => b.month.localeCompare(a.month));

    // Date range
    const dates = txs.map((t) => t.date).sort();
    const earliest = dates[0];
    const latest = dates[dates.length - 1];

    // Per-account breakdown
    const accountCounts = new Map<string, number>();
    for (const t of txs) {
      const key = t.bank_name
        ? `${t.bank_name} ${t.account_number || ""}`.trim()
        : "Unknown";
      accountCounts.set(key, (accountCounts.get(key) || 0) + 1);
    }
    const accounts = [...accountCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Total sum
    const totalSum = Math.round(txs.reduce((s, t) => s + t.amount, 0) * 100) / 100;

    return {
      sameHashCount,
      sameHashGroups,
      monthlySums: monthlySumsArr,
      earliest,
      latest,
      accounts,
      totalSum,
    };
  }, [allTransactions]);

  useEffect(() => {
    async function fetchUsers() {
      try {
        const dek = getDEK();
        const [usersRes, userRes, rulesRes, catsRes] = await Promise.all([
          fetch("/api/users"),
          fetch("/api/user"),
          fetch("/api/merchant-rules"),
          fetch("/api/categories"),
        ]);

        if (usersRes.ok) {
          const rawUsers = await usersRes.json();
          setUsers(await decryptEntities(rawUsers, dek) as unknown as User[]);
        }

        if (userRes.ok) {
          const rawUser = await userRes.json();
          const currentUser = await decryptEntity(rawUser, dek) as unknown as User;
          setSelectedUserId(currentUser.id);
          if (rawUser.household_id) setHouseholdId(rawUser.household_id);
        }

        if (rulesRes.ok) {
          const rawRules = await rulesRes.json();
          const rules = await decryptEntities(rawRules, dek) as unknown as MerchantRule[];
          setMerchantRules(rules);
          merchantRulesRef.current = rules;
        }

        if (catsRes.ok) {
          const rawCats = await catsRes.json();
          setCategories(await decryptEntities(rawCats, dek) as unknown as Category[]);
        }
      } catch {
        toast.error("Failed to load household members");
      }
    }

    fetchUsers();
  }, []);

  useEffect(() => {
    async function fetchBatches() {
      try {
        const dek = getDEK();
        const res = await fetch("/api/upload-batches");
        if (res.ok) {
          const rawBatches = await res.json();
          const decrypted = await decryptEntities(rawBatches, dek);
          setBatches(decrypted as unknown as UploadBatch[]);
        }
      } catch {
        // silent — non-critical
      } finally {
        setLoadingBatches(false);
      }
    }
    fetchBatches();
  }, []);

  // Re-run auto-categorization when merchant rules load after files are already parsed
  useEffect(() => {
    if (merchantRules.length === 0 || fileResults.length === 0) return;

    setFileResults((prev) =>
      prev.map((result) => ({
        ...result,
        transactions: result.transactions.map((t) => ({
          ...t,
          autoCategory:
            t.autoCategory ??
            autoCategorizeImport(
              t.description || "",
              t.amount,
              t.transaction_type || null,
              merchantRules
            ),
        })),
      }))
    );
  }, [merchantRules]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run server-side dedup check when files are loaded.
  // Depends on fileResults (stable state) and householdId.
  useEffect(() => {
    const txs = fileResults.flatMap((r) => r.transactions).filter((t) => !t.isDuplicate);
    if (txs.length === 0 || !householdId) {
      setDedupCheck(null);
      return;
    }

    let cancelled = false;
    setDedupCheck({
      loading: true,
      existingHashes: new Set(),
      totalInDb: 0,
      skippedExact: 0,
      skippedLegacy: 0,
      willImport: txs.length,
      newIndices: new Set(),
    });

    (async () => {
      try {
        // Step 1: Compute occurrences synchronously (no race conditions)
        const occurrenceMap = new Map<string, number>();
        const txMeta = txs.map((t) => {
          const desc = t.description || "encrypted";
          const sig = txSignature(t.date, t.amount, desc, t.account_number);
          const occ = occurrenceMap.get(sig) || 0;
          occurrenceMap.set(sig, occ + 1);
          return { t, desc, occ };
        });

        // Step 2: Hash in batches with Promise.all (safe now — occ is pre-computed)
        const hashData: { newHash: string; legacyHash: string | undefined }[] = [];
        const BATCH = 200;

        for (let i = 0; i < txMeta.length; i += BATCH) {
          if (cancelled) return;
          const batch = txMeta.slice(i, i + BATCH);
          const batchResults = await Promise.all(
            batch.map(async ({ t, desc, occ }) => {
              const newHash = await generateImportHash(householdId, t.date, t.amount, desc, t.account_number, occ);
              const legacyHash = occ === 0
                ? await generateLegacyImportHash(householdId, t.date, t.amount, desc)
                : undefined;
              return { newHash, legacyHash };
            })
          );
          hashData.push(...batchResults);
          if (i + BATCH < txMeta.length) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        if (cancelled) return;

        // Collect all unique hashes to check
        const allHashes = new Set<string>();
        for (const h of hashData) {
          allHashes.add(h.newHash);
          if (h.legacyHash) allHashes.add(h.legacyHash);
        }

        const res = await fetch("/api/transactions/check-hashes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hashes: [...allHashes] }),
        });

        if (cancelled) return;

        if (!res.ok) {
          setDedupCheck(null);
          return;
        }

        const { existing, total }: { existing: string[]; total: number } = await res.json();
        const existingSet = new Set(existing);

        let skippedExact = 0;
        let skippedLegacy = 0;
        let willImport = 0;
        const newIndices = new Set<number>();

        for (let idx = 0; idx < hashData.length; idx++) {
          const h = hashData[idx];
          if (existingSet.has(h.newHash)) {
            skippedExact++;
          } else if (h.legacyHash && existingSet.has(h.legacyHash)) {
            skippedLegacy++;
          } else {
            willImport++;
            newIndices.add(idx);
          }
        }

        if (!cancelled) {
          setDedupCheck({
            loading: false,
            existingHashes: existingSet,
            totalInDb: total,
            skippedExact,
            skippedLegacy,
            willImport,
            newIndices,
          });
        }
      } catch {
        if (!cancelled) setDedupCheck(null);
      }
    })();

    return () => { cancelled = true; };
  }, [fileResults, householdId]);

  async function handleDeleteBatch(batchId: string) {
    if (!confirm("Delete this upload and all its transactions? This cannot be undone.")) {
      return;
    }
    setDeletingBatchId(batchId);
    try {
      const res = await fetch(`/api/upload-batches/${batchId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setBatches((prev) => prev.filter((b) => b.id !== batchId));
        await dataCache.refreshTransactions();
        toast.success("Upload batch deleted");
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete batch");
      }
    } catch {
      toast.error("Failed to delete batch");
    } finally {
      setDeletingBatchId(null);
    }
  }

  const handleFiles = useCallback((files: File[]) => {
    const validFiles = files.filter(
      (f) => f.name.endsWith(".csv") || f.name.endsWith(".json")
    );

    if (validFiles.length === 0) {
      toast.error("Please upload .csv or .json files");
      return;
    }

    if (validFiles.length < files.length) {
      toast.warning(
        `Skipped ${files.length - validFiles.length} unsupported file(s)`
      );
    }

    // Read all files, then parse together
    const readPromises = validFiles.map(
      (file) =>
        new Promise<{ content: string; fileName: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) =>
            resolve({
              content: e.target?.result as string,
              fileName: file.name,
            });
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
          reader.readAsText(file);
        })
    );

    Promise.all(readPromises)
      .then((readFiles) => {
        const results = parseFiles(readFiles);

        const errors = results.filter((r) => r.error);
        if (errors.length > 0) {
          for (const e of errors) {
            toast.error(`${e.fileName}: ${e.error}`);
          }
        }

        const totalTx = results.reduce(
          (sum, r) => sum + r.transactions.length,
          0
        );
        const metadataFiles = results.filter(
          (r) => r.format === "zlantar_data"
        );

        if (totalTx === 0 && metadataFiles.length === 0) {
          toast.error("No transactions found in uploaded files");
          return;
        }

        // Auto-categorize transactions using decrypted merchant rules
        const rules = merchantRulesRef.current;
        if (rules.length > 0) {
          for (const result of results) {
            for (const t of result.transactions) {
              if (!t.autoCategory) {
                t.autoCategory = autoCategorizeImport(
                  t.description || "",
                  t.amount,
                  t.transaction_type || null,
                  rules
                );
              }
            }
          }
        }

        setFileResults(results);

        // Scroll to import summary after a short delay (DOM needs to render)
        if (totalTx > 0) {
          setTimeout(() => {
            summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }

        if (metadataFiles.length > 0 && totalTx === 0) {
          toast.info(
            "Account metadata loaded. Upload a transaction file (CSV or JSON) to import transactions."
          );
        }
      })
      .catch(() => {
        toast.error("Failed to read files");
      });
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) handleFiles(files);
  }

  function removeFile(index: number) {
    setFileResults((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Re-run merge logic by re-parsing
      // Simple approach: just remove the file result
      return next;
    });
  }

  function clearAll() {
    setFileResults([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleImport() {
    if (!selectedUserId) {
      toast.error("Please select a user");
      return;
    }

    const nonDupTransactions = allTransactions.filter((t) => !t.isDuplicate);

    // Compute occurrences from ALL non-duplicate transactions (same order as
    // the dedup check useEffect) so that each transaction keeps the same
    // occurrence index it had when the dedup check ran.
    const allOccurrenceMap = new Map<string, number>();
    const allOccurrences: number[] = [];
    for (const t of nonDupTransactions) {
      const sig = txSignature(t.date, t.amount, t.description || "encrypted", t.account_number);
      const count = allOccurrenceMap.get(sig) || 0;
      allOccurrences.push(count);
      allOccurrenceMap.set(sig, count + 1);
    }

    // Filter to truly new ones, carrying along their correct occurrence values
    const newWithOcc = dedupCheck && !dedupCheck.loading
      ? nonDupTransactions
          .map((t, i) => ({ t, occ: allOccurrences[i] }))
          .filter((_, i) => dedupCheck.newIndices.has(i))
      : nonDupTransactions.map((t, i) => ({ t, occ: allOccurrences[i] }));

    if (newWithOcc.length === 0) {
      toast.error("No new transactions to import");
      return;
    }

    setImporting(true);
    try {
      // Generate import hashes and encrypt each transaction.
      // We send both the new hash (with account_number + occurrence) and the
      // legacy hash so the server can skip transactions already imported under
      // the old format.
      const txPayload = await Promise.all(
        newWithOcc.map(async ({ t, occ }) => {
          const desc = t.description || "encrypted";
          const import_hash = t.import_hash || await generateImportHash(
            householdId,
            t.date,
            t.amount,
            desc,
            t.account_number,
            occ
          );
          // Only the first occurrence (0) can match a legacy hash.
          // Later occurrences were never imported under the old format
          // (they were the ones that got dropped), so no legacy check needed.
          const legacy_hash = occ === 0
            ? await generateLegacyImportHash(householdId, t.date, t.amount, desc)
            : undefined;
          const encrypted_data = await encryptTransaction(
            t as unknown as Record<string, unknown>
          );
          return {
            encrypted_data,
            import_hash,
            legacy_hash,
            category_id: t.autoCategory ?? null,
          };
        })
      );

      // Send the import request
      const res = await fetch("/api/transactions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: txPayload,
          user_id: selectedUserId,
          // Encrypt batch metadata including rich stats
          encrypted_batch: await encryptFields(
            {
              file_names: fileResults.map((r) => r.fileName),
              file_transaction_count: allTransactions.length,
            },
            ["file_names", "file_transaction_count"]
          ),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to import");
        return;
      }

      const data = await res.json();
      const importedCount = data.imported ?? 0;

      // Compute monthly sums only for actually imported transactions.
      const importedTxs = newWithOcc.map(({ t }) => t);

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
      const targetMonths = new Set([currentMonth, prevMonth]);

      const monthlySums = new Map<string, number>();
      for (const t of importedTxs) {
        const txMonth = t.date.slice(0, 7);
        if (targetMonths.has(txMonth)) {
          monthlySums.set(txMonth, (monthlySums.get(txMonth) || 0) + t.amount);
        }
      }
      const monthlySumsArr = [...monthlySums.entries()]
        .map(([month, sum]) => ({ month, sum: Math.round(sum * 100) / 100 }))
        .sort((a, b) => b.month.localeCompare(a.month));

      // Update the batch with the full stats
      const batchStats: UploadBatchStats = {
        skipped_exact: data.skipped_exact ?? 0,
        skipped_legacy: data.skipped_legacy ?? 0,
        total_before: data.total_before ?? 0,
        monthly_sums: monthlySumsArr,
      };

      if (data.transactions?.length > 0) {
        const batchId = data.transactions[0]?.batch_id;
        if (batchId) {
          const updatedEncrypted = await encryptFields(
            {
              file_names: fileResults.map((r) => r.fileName),
              file_transaction_count: allTransactions.length,
              stats: batchStats,
            },
            ["file_names", "file_transaction_count", "stats"]
          );
          fetch(`/api/upload-batches/${batchId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ encrypted_data: updatedEncrypted }),
          }).catch(() => {/* non-critical */});
        }
      }

      toast.success(
        `Imported ${importedCount} new transaction${importedCount !== 1 ? "s" : ""}` +
          (data.duplicates > 0
            ? ` (${data.duplicates} already in database, skipped)`
            : "")
      );
      clearAll();
      // Refresh the data cache so the transactions page has the new data immediately
      await dataCache.refreshTransactions();
      router.push("/dashboard/transactions");
    } catch {
      toast.error("Failed to import transactions");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Upload Transactions</h1>

      {/* User selector */}
      {users.length > 0 && (
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <label className="text-sm font-medium whitespace-nowrap">
              Whose transactions are these?
            </label>
            <select
              title="Select transaction owner"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      {/* Import methods */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Method 1: Zlantar */}
        <Card className="relative overflow-hidden">
          <div className="absolute top-3 right-3">
            <Badge className="text-[10px]">Recommended</Badge>
          </div>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base">Sync from Zlantar App</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Connect your bank accounts through Zlantar to automatically sync and generate all your transactions. Export as CSV or JSON from their dashboard.
            </p>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              Note: Zlantar is a third-party service that may collect your data. We are working on a direct bank integration.
            </div>
            <a
              href="https://www.zlantar.se/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Go to Zlantar
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </CardContent>
        </Card>

        {/* Method 2: Manual upload */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base">Upload CSV / JSON</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Generate your own file using our template. Required fields: <strong>description</strong>, <strong>date</strong>, and <strong>amount</strong>. All other fields are optional.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href="/templates/transactions-template.csv"
                download
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
              >
                <Download className="h-3 w-3" />
                CSV template
              </a>
              <a
                href="/templates/transactions-template.json"
                download
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
              >
                <Download className="h-3 w-3" />
                JSON template
              </a>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-1">
              <p><strong>Required columns:</strong> description, date (YYYY-MM-DD), amount</p>
              <p><strong>Optional:</strong> transaction_type, category, subcategory, tags, notes, bank_name, account_number, account_name</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* File dropzone */}
      <Card>
        <CardContent className="p-6">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
              isDragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
          >
            <FileUp className="mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">
              Drop your files here or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Supports Zlantar exports, bank CSV files, and our template format (.csv, .json)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              title="Upload transaction files"
              accept=".csv,.json"
              multiple
              onChange={handleFileInput}
              className="hidden"
            />
          </div>
        </CardContent>
      </Card>

      {/* Uploaded files list */}
      {fileResults.length > 0 && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Uploaded Files</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  className="text-muted-foreground"
                >
                  Clear all
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {fileResults.map((result, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <FormatIcon format={result.format} />
                    <span className="text-sm font-medium truncate">
                      {result.fileName}
                    </span>
                    <Badge variant={FORMAT_COLORS[result.format]} className="text-xs">
                      {FORMAT_LABELS[result.format]}
                    </Badge>
                    {result.transactions.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {result.transactions.length} transactions
                      </span>
                    )}
                    {result.accounts.length > 0 &&
                      result.format === "zlantar_data" && (
                        <span className="text-xs text-muted-foreground">
                          {result.accounts.length} accounts
                        </span>
                      )}
                    {result.error && (
                      <span className="text-xs text-destructive">
                        {result.error}
                      </span>
                    )}
                    <button
                      type="button"
                      title={`Remove ${result.fileName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(i);
                      }}
                      className="ml-auto rounded-md p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Account metadata preview */}
          {hasMetadata && uniqueAccounts.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Detected Accounts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bank</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Type</TableHead>
                        {uniqueAccounts.some((a) => a.balance != null) && (
                          <TableHead className="text-right">Balance</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uniqueAccounts.map((acc, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">
                            {acc.bank_name}
                          </TableCell>
                          <TableCell>{acc.account_name}</TableCell>
                          <TableCell>
                            {acc.account_type && (
                              <Badge variant="outline" className="text-xs">
                                {acc.account_type}
                              </Badge>
                            )}
                          </TableCell>
                          {uniqueAccounts.some((a) => a.balance != null) && (
                            <TableCell className="text-right font-mono">
                              {acc.balance != null
                                ? formatCurrency(acc.balance)
                                : "—"}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pre-import stats + import button */}
          {allTransactions.length > 0 && (
            <>
              <Card ref={summaryRef}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Import Summary</CardTitle>
                    {dedupCheck?.loading && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Checking for duplicates...
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Top-level counts */}
                  {(() => {
                    const hasCheck = dedupCheck && !dedupCheck.loading;
                    const willImport = hasCheck ? dedupCheck.willImport : newCount;
                    const totalSkipped = hasCheck ? dedupCheck.skippedExact + dedupCheck.skippedLegacy : 0;

                    return (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          <div className="rounded-lg border p-3 space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <FileText className="h-3 w-3" />
                              In file
                            </div>
                            <p className="text-lg font-semibold">{allTransactions.length}</p>
                          </div>
                          <div className="rounded-lg border p-3 space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-green-600">
                              <CheckCircle2 className="h-3 w-3" />
                              New (will import)
                            </div>
                            <p className="text-lg font-semibold text-green-600">
                              {dedupCheck?.loading ? (
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                </span>
                              ) : willImport}
                            </p>
                          </div>
                          {hasCheck && totalSkipped > 0 && (
                            <div className="rounded-lg border p-3 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <ShieldCheck className="h-3 w-3" />
                                Already in DB
                              </div>
                              <p className="text-lg font-semibold">{totalSkipped}</p>
                              <div className="space-y-0.5 pt-0.5">
                                {dedupCheck.skippedExact > 0 && (
                                  <p className="text-[11px] text-muted-foreground" title="Exact hash match — this transaction was already imported with the same dedup key">
                                    {dedupCheck.skippedExact} exact match
                                  </p>
                                )}
                                {dedupCheck.skippedLegacy > 0 && (
                                  <p className="text-[11px] text-muted-foreground" title="Matched via old hash format (before account-aware dedup). This was the first occurrence that got imported previously.">
                                    {dedupCheck.skippedLegacy} legacy match
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                          {dupCount > 0 && (
                            <div className="rounded-lg border p-3 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Copy className="h-3 w-3" />
                                In-file duplicates
                              </div>
                              <p className="text-lg font-semibold">{dupCount}</p>
                            </div>
                          )}
                          {hasCheck && dedupCheck.totalInDb > 0 && (
                            <div className="rounded-lg border p-3 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Database className="h-3 w-3" />
                                Currently in DB
                              </div>
                              <p className="text-lg font-semibold">
                                {dedupCheck.totalInDb.toLocaleString("sv-SE")}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                After: {(dedupCheck.totalInDb + willImport).toLocaleString("sv-SE")}
                              </p>
                            </div>
                          )}
                        </div>

                        {autoCatCount > 0 && (
                          <div className="flex items-center gap-1.5 text-xs text-blue-600">
                            <Zap className="h-3 w-3" />
                            {autoCatCount} of {willImport} will be auto-categorized by merchant rules
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {preImportStats && (
                    <>
                      {/* Same-hash info */}
                      {preImportStats.sameHashCount > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                          <div className="flex items-start gap-2">
                            <Info className="h-4 w-4 mt-0.5 shrink-0" />
                            <div>
                              <p className="font-medium">
                                {preImportStats.sameHashCount} transactions across {preImportStats.sameHashGroups} group(s) share identical date, amount, description, and account.
                              </p>
                              <p className="text-xs mt-1 opacity-80">
                                Each gets a unique hash via an occurrence counter — none will be lost or collapsed.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Date range + total sum */}
                      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Date range</span>
                          <p className="font-medium">
                            {preImportStats.earliest} — {preImportStats.latest}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Total sum (belopp)</span>
                          <p className={`font-mono font-medium ${preImportStats.totalSum >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {formatCurrency(preImportStats.totalSum)}
                          </p>
                        </div>
                      </div>

                      {/* Monthly sums */}
                      {preImportStats.monthlySums.length > 0 && (
                        <div className="rounded-lg border p-3">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                            <span className="font-medium">Total sum of belopp</span>
                            <button
                              type="button"
                              className="group relative"
                              title="Compare these sums against your bank statements for the same months to verify all transactions were imported correctly."
                            >
                              <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" />
                              <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-56 rounded-md bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md border opacity-0 pointer-events-none group-focus:opacity-100 group-focus:pointer-events-auto sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto z-50 text-left">
                                Compare these sums against your bank statements for the same months to verify all transactions were imported correctly.
                              </span>
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-6">
                            {preImportStats.monthlySums.map((ms) => {
                              const [y, m] = ms.month.split("-");
                              const monthLabel = new Date(Number(y), Number(m) - 1).toLocaleDateString("sv-SE", {
                                year: "numeric",
                                month: "long",
                              });
                              return (
                                <div key={ms.month} className="space-y-0.5">
                                  <p className="text-xs text-muted-foreground capitalize">{monthLabel}</p>
                                  <p className={`text-sm font-mono font-medium ${ms.sum >= 0 ? "text-green-600" : "text-red-600"}`}>
                                    {formatCurrency(ms.sum)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Per-account breakdown */}
                      {preImportStats.accounts.length > 1 && (
                        <div className="rounded-lg border p-3">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                            <Database className="h-3 w-3" />
                            Transactions per account (in file)
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {preImportStats.accounts.map((acc) => (
                              <Badge key={acc.name} variant="outline" className="text-xs font-normal">
                                {acc.name} <span className="ml-1 font-semibold">{acc.count}</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Import action bar */}
                  <div className="flex items-center gap-3 pt-2 border-t">
                    <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Payer:</label>
                    <select
                      title="Assign transactions to user"
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <div className="ml-auto">
                      <Button
                        onClick={handleImport}
                        disabled={importing || newCount === 0 || dedupCheck?.loading}
                        size="lg"
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        {importing
                          ? "Importing..."
                          : dedupCheck?.loading
                            ? "Checking..."
                            : dedupCheck && !dedupCheck.loading
                              ? `Import ${dedupCheck.willImport} transactions`
                              : `Import ${newCount} transactions`}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Preview table — only new transactions when dedup check is done */}
              {(() => {
                const hasCheck = dedupCheck && !dedupCheck.loading;
                const nonDup = allTransactions.filter((t) => !t.isDuplicate);
                const previewTxs = hasCheck
                  ? nonDup.filter((_, i) => dedupCheck.newIndices.has(i))
                  : nonDup;
                const previewSorted = [...previewTxs].sort((a, b) => b.date.localeCompare(a.date));
                const previewLabel = hasCheck
                  ? `${previewTxs.length} new transactions to import`
                  : `${previewTxs.length} transactions`;

                return previewSorted.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        Preview
                        <Badge variant="outline" className="text-xs font-normal">
                          {previewLabel}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Account</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewSorted.map((t, i) => (
                              <TableRow key={i}>
                                <TableCell className="whitespace-nowrap">
                                  {t.date.slice(0, 10)}
                                </TableCell>
                                <TableCell className="max-w-[300px] truncate">
                                  {t.description}
                                  {t.autoCategory && (
                                    <Badge
                                      variant="outline"
                                      className="ml-2 text-xs"
                                    >
                                      {categoryMap.get(t.autoCategory) || "Auto"}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatCurrency(t.amount)}
                                </TableCell>
                                <TableCell>
                                  {t.transaction_type && (
                                    <Badge variant="secondary" className="text-xs">
                                      {t.transaction_type}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {t.bank_name && (
                                    <span className="text-xs text-muted-foreground">
                                      {t.bank_name} {t.account_number || ""}
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                ) : null;
              })()}
            </>
          )}
        </>
      )}

      {/* Upload History */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Upload History</CardTitle>
            </div>
            {batches.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                disabled={deletingBatchId === "all"}
                onClick={() => {
                  setDeleteConfirmText("");
                  setShowDeleteAllDialog(true);
                }}
              >
                {deletingBatchId === "all" ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                )}
                Delete all & start fresh
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingBatches ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : batches.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No upload history yet
            </p>
          ) : (
            <div className="space-y-0 divide-y">
              {batches.map((batch) => {
                const isExpanded = expandedBatchId === batch.id;
                const stats = batch.stats;
                const totalSkipped = batch.duplicate_count;
                const totalInFile = batch.transaction_count + totalSkipped;

                return (
                  <div key={batch.id}>
                    {/* Main row */}
                    <div
                      className="flex items-center gap-3 py-3 cursor-pointer hover:bg-muted/30 transition-colors -mx-6 px-6"
                      onClick={() => setExpandedBatchId(isExpanded ? null : batch.id)}
                    >
                      {/* Expand chevron */}
                      <div className="shrink-0 text-muted-foreground">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </div>

                      {/* Date */}
                      <div className="shrink-0 whitespace-nowrap text-sm">
                        {new Date(batch.created_at).toLocaleDateString("sv-SE")}{" "}
                        <span className="text-muted-foreground">
                          {new Date(batch.created_at).toLocaleTimeString("sv-SE", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>

                      {/* Files */}
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {batch.file_names && batch.file_names.length > 0 ? (
                          batch.file_names.map((fname: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs truncate max-w-[200px]">
                              {fname}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>

                      {/* Summary badges */}
                      <div className="ml-auto flex items-center gap-2 shrink-0">
                        <Badge variant="default" className="text-xs">
                          +{batch.transaction_count} new
                        </Badge>
                        {totalSkipped > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {totalSkipped} skipped
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {users.find((u) => u.id === batch.user_id)?.name || "—"}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          disabled={deletingBatchId === batch.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteBatch(batch.id);
                          }}
                        >
                          {deletingBatchId === batch.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="pb-4 pt-1 pl-10 space-y-3">
                        {/* Stats grid */}
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {/* Transactions in file */}
                          <div className="rounded-lg border p-3 space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <FileText className="h-3 w-3" />
                              In file
                            </div>
                            <p className="text-lg font-semibold">{totalInFile}</p>
                          </div>

                          {/* Imported */}
                          <div className="rounded-lg border p-3 space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-green-600">
                              <CheckCircle2 className="h-3 w-3" />
                              Imported
                            </div>
                            <p className="text-lg font-semibold text-green-600">
                              {batch.transaction_count}
                            </p>
                          </div>

                          {/* Skipped breakdown */}
                          <div className="rounded-lg border p-3 space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <AlertCircle className="h-3 w-3" />
                              Skipped
                            </div>
                            <p className="text-lg font-semibold">{totalSkipped}</p>
                            {stats && (stats.skipped_exact || stats.skipped_legacy) ? (
                              <div className="space-y-0.5 pt-0.5">
                                {(stats.skipped_exact ?? 0) > 0 && (
                                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Exact duplicate — same hash already exists in the database">
                                    <Copy className="h-3 w-3 shrink-0" />
                                    <span>{stats.skipped_exact} exact duplicates</span>
                                  </div>
                                )}
                                {(stats.skipped_legacy ?? 0) > 0 && (
                                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Matched via legacy hash — transaction was imported before the dedup improvement (without account number)">
                                    <ShieldCheck className="h-3 w-3 shrink-0" />
                                    <span>{stats.skipped_legacy} legacy matches</span>
                                  </div>
                                )}
                              </div>
                            ) : totalSkipped > 0 ? (
                              <p className="text-[11px] text-muted-foreground">All duplicates</p>
                            ) : null}
                          </div>

                          {/* Total before */}
                          {stats?.total_before != null && (
                            <div className="rounded-lg border p-3 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Database className="h-3 w-3" />
                                Total before
                              </div>
                              <p className="text-lg font-semibold">
                                {stats.total_before.toLocaleString("sv-SE")}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                After: {(stats.total_before + batch.transaction_count).toLocaleString("sv-SE")}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Monthly sums */}
                        {stats?.monthly_sums && stats.monthly_sums.length > 0 && (
                          <div className="rounded-lg border p-3">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                              <Info className="h-3 w-3" />
                              Total sum of belopp
                            </div>
                            <div className="flex flex-wrap gap-4">
                              {stats.monthly_sums.map((ms) => {
                                const [y, m] = ms.month.split("-");
                                const monthLabel = new Date(Number(y), Number(m) - 1).toLocaleDateString("sv-SE", {
                                  year: "numeric",
                                  month: "long",
                                });
                                return (
                                  <div key={ms.month} className="space-y-0.5">
                                    <p className="text-xs text-muted-foreground capitalize">{monthLabel}</p>
                                    <p className={`text-sm font-mono font-medium ${ms.sum >= 0 ? "text-green-600" : "text-red-600"}`}>
                                      {formatCurrency(ms.sum)}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Extra info */}
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            Uploaded by: {users.find((u) => u.id === batch.uploaded_by)?.name || "—"}
                          </span>
                          <span>
                            Payer: {users.find((u) => u.id === batch.user_id)?.name || "—"}
                          </span>
                          <span>
                            Source: {batch.source || "—"}
                          </span>
                        </div>

                        {/* Imported transactions table */}
                        {(() => {
                          const batchTxs = dataCache.transactions
                            .filter((t) => t.batch_id === batch.id)
                            .sort((a, b) => b.date.localeCompare(a.date));
                          if (batchTxs.length === 0) return (
                            <p className="text-xs text-muted-foreground italic">
                              {dataCache.loading ? "Loading transactions..." : "No transactions found for this batch"}
                            </p>
                          );
                          return (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Database className="h-3 w-3" />
                                {batchTxs.length} imported transaction{batchTxs.length !== 1 ? "s" : ""}
                              </div>
                              <div className="overflow-x-auto rounded-lg border">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Date</TableHead>
                                      <TableHead>Description</TableHead>
                                      <TableHead className="text-right">Amount</TableHead>
                                      <TableHead>Type</TableHead>
                                      <TableHead>Category</TableHead>
                                      <TableHead>Account</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {batchTxs.map((t) => (
                                      <TableRow key={t.id}>
                                        <TableCell className="whitespace-nowrap text-xs">
                                          {t.date.slice(0, 10)}
                                        </TableCell>
                                        <TableCell className="max-w-[300px] truncate text-xs">
                                          {t.description}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono text-xs ${t.amount >= 0 ? "text-green-600" : ""}`}>
                                          {formatCurrency(t.amount)}
                                        </TableCell>
                                        <TableCell>
                                          {t.transaction_type && (
                                            <Badge variant="secondary" className="text-[10px]">
                                              {t.transaction_type}
                                            </Badge>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {t.category_id && (
                                            <Badge variant="outline" className="text-[10px]">
                                              {categoryMap.get(t.category_id) || "—"}
                                            </Badge>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                          {t.bank_name || ""} {t.account_number || ""}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete All confirmation dialog */}
      <Dialog
        open={showDeleteAllDialog}
        onOpenChange={(open) => {
          setShowDeleteAllDialog(open);
          if (!open) setDeleteConfirmText("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete all transactions</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>ALL transactions and upload batches</strong> for
              your entire household. Because all data is end-to-end encrypted, there is
              <strong> no way to recover it</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label htmlFor="delete-confirm" className="text-sm font-medium">
              Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm
            </label>
            <Input
              id="delete-confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" />}
            >
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== "DELETE" || deletingBatchId === "all"}
              onClick={async () => {
                setDeletingBatchId("all");
                try {
                  const res = await fetch("/api/upload-batches", { method: "DELETE" });
                  if (res.ok) {
                    setBatches([]);
                    setDedupCheck(null);
                    await dataCache.refreshTransactions();
                    toast.success("All transactions and batches deleted. Ready for clean re-import.");
                  } else {
                    const d = await res.json();
                    toast.error(d.error || "Failed to delete");
                  }
                } catch {
                  toast.error("Failed to delete");
                } finally {
                  setDeletingBatchId(null);
                  setShowDeleteAllDialog(false);
                  setDeleteConfirmText("");
                }
              }}
            >
              {deletingBatchId === "all" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
