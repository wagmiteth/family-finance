"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseFiles } from "@/lib/transactions/parser";
import { autoCategorizeImport, checkExcludeRule } from "@/lib/transactions/categorizer";
import { encryptTransaction, encryptFields, decryptEntities, decryptEntity } from "@/lib/crypto/entity-crypto";
import { getDEK } from "@/lib/crypto/key-store";
import { generateImportHash, generateLegacyImportHash, txSignature } from "@/lib/transactions/dedup";
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
  AlertTriangle,
  EyeOff,
  Eye,
  CalendarDays,
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
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import type {
  FileParseResult,
  User,
  MerchantRule,
  Category,
  FileFormat,
  Transaction,
} from "@/lib/types";
import { SETTLEMENT_TRANSACTION_TYPE } from "@/lib/settlements/calculator";

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

// Local-date ISO "YYYY-MM-DD" (avoids UTC off-by-one from toISOString).
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(s: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
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
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [householdId, setHouseholdId] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [deleteBatchDialog, setDeleteBatchDialog] = useState<{
    batchId: string;
    settledCount: number;
    settlementPaymentCount: number;
    affectedMonths: string[];
    affectedSettlementIds: string[]; // settlement IDs to fully reopen
  } | null>(null);
  const [dedupCheck, setDedupCheck] = useState<{
    loading: boolean;
    existingHashes: Set<string>;
    totalInDb: number;
    skippedExact: number;
    skippedLegacy: number;
    willImport: number;
    /** Set of transaction indices (within allTransactions non-dup list) that are new */
    newIndices: Set<number>;
    /** Per-nonDup-index dedup status: 'new' | 'exact' | 'legacy' */
    statusByIndex: Array<"new" | "exact" | "legacy">;
  } | null>(null);
  // Exclusion tracking — indices into the non-duplicate transaction list
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());
  const [savingExcludeRule, setSavingExcludeRule] = useState(false);
  const [excludeRuleSaved, setExcludeRuleSaved] = useState<Set<number>>(new Set());
  // Date range filter — limits which transactions get imported. Undefined = no filter.
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

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
  const excludedCount = excludedIndices.size;
  // Count excluded that are actually importable (new, not dedup-skipped)
  const importableExcluded = dedupCheck && !dedupCheck.loading
    ? [...excludedIndices].filter((i) => dedupCheck.newIndices.has(i)).length
    : excludedCount;

  // Date range filter — indices (into non-duplicate list) that fall outside the selected range.
  // Defer the heavy recompute so the calendar stays responsive while user clicks around.
  const deferredDateRange = useDeferredValue(dateRange);
  const dateRangeFromStr = useMemo(
    () => (deferredDateRange?.from ? toISODate(deferredDateRange.from) : null),
    [deferredDateRange?.from]
  );
  const dateRangeToStr = useMemo(
    () => (deferredDateRange?.to ? toISODate(deferredDateRange.to) : null),
    [deferredDateRange?.to]
  );
  const outsideRangeIndices = useMemo(() => {
    const out = new Set<number>();
    if (!dateRangeFromStr && !dateRangeToStr) return out;
    const nonDup = allTransactions.filter((t) => !t.isDuplicate);
    nonDup.forEach((t, i) => {
      const d = (t.date || "").slice(0, 10);
      if (dateRangeFromStr && d < dateRangeFromStr) out.add(i);
      else if (dateRangeToStr && d > dateRangeToStr) out.add(i);
    });
    return out;
  }, [allTransactions, dateRangeFromStr, dateRangeToStr]);

  // Count new transactions dropped by date filter (new AND not already excluded)
  const importableOutsideRange = useMemo(() => {
    if (outsideRangeIndices.size === 0) return 0;
    const newSet = dedupCheck && !dedupCheck.loading ? dedupCheck.newIndices : null;
    let count = 0;
    for (const i of outsideRangeIndices) {
      if (excludedIndices.has(i)) continue;
      if (newSet && !newSet.has(i)) continue;
      count++;
    }
    return count;
  }, [outsideRangeIndices, excludedIndices, dedupCheck]);

  const importableCount =
    (dedupCheck && !dedupCheck.loading ? dedupCheck.willImport : newCount) -
    importableExcluded -
    importableOutsideRange;

  // Counts reflecting the selected date range. Null when no range is active — tiles
  // should fall back to their raw full-file counts in that case.
  const rangeFiltered = useMemo(() => {
    const hasRange = Boolean(dateRangeFromStr || dateRangeToStr);
    if (!hasRange) return null;

    const inRange = (d: string) => {
      const s = (d || "").slice(0, 10);
      if (dateRangeFromStr && s < dateRangeFromStr) return false;
      if (dateRangeToStr && s > dateRangeToStr) return false;
      return true;
    };

    let inFile = 0;
    let duplicates = 0;
    let autoCat = 0;
    let totalSum = 0;
    const monthlySumsMap = new Map<string, number>();
    const accountCounts = new Map<string, number>();
    const nonDupTxsInRange: typeof allTransactions = [];

    for (const t of allTransactions) {
      if (!inRange(t.date)) continue;
      inFile++;
      if (t.isDuplicate) {
        duplicates++;
        continue;
      }
      nonDupTxsInRange.push(t);
      if (t.autoCategory) autoCat++;
      totalSum += t.amount;
      const month = t.date.slice(0, 7);
      monthlySumsMap.set(month, (monthlySumsMap.get(month) || 0) + t.amount);
      const key = t.bank_name
        ? `${t.bank_name} ${t.account_number || ""}`.trim()
        : "Unknown";
      accountCounts.set(key, (accountCounts.get(key) || 0) + 1);
    }

    // Skipped counts — iterate nonDup indices, skip the ones outside range.
    let skippedExact = 0;
    let skippedLegacy = 0;
    if (dedupCheck && !dedupCheck.loading && dedupCheck.statusByIndex.length) {
      const nonDup = allTransactions.filter((t) => !t.isDuplicate);
      nonDup.forEach((_, i) => {
        if (outsideRangeIndices.has(i)) return;
        const status = dedupCheck.statusByIndex[i];
        if (status === "exact") skippedExact++;
        else if (status === "legacy") skippedLegacy++;
      });
    }

    const monthlySums = [...monthlySumsMap.entries()]
      .map(([month, sum]) => ({ month, sum: Math.round(sum * 100) / 100 }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const accounts = [...accountCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      inFile,
      duplicates,
      autoCat,
      skippedExact,
      skippedLegacy,
      totalSum: Math.round(totalSum * 100) / 100,
      monthlySums,
      accounts,
    };
  }, [allTransactions, dateRangeFromStr, dateRangeToStr, dedupCheck, outsideRangeIndices]);
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
          setCurrentUserId(currentUser.id);
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

  // Re-run auto-categorization + exclude rules when merchant rules load after files are already parsed
  useEffect(() => {
    if (merchantRules.length === 0 || fileResults.length === 0) return;

    setFileResults((prev) =>
      prev.map((result) => ({
        ...result,
        transactions: result.transactions.map((t) => {
          const excludeMatch = checkExcludeRule(t.description, t.amount, merchantRules);
          return {
            ...t,
            autoCategory:
              t.autoCategory ??
              autoCategorizeImport(
                t.transaction_type || null,
                merchantRules
              ),
            isExcluded: excludeMatch ? true : t.isExcluded,
            excludeRuleId: excludeMatch?.id ?? t.excludeRuleId,
          };
        }),
      }))
    );

    // Build initial excludedIndices from exclude rules
    const allTxs = fileResults.flatMap((r) => r.transactions);
    const nonDup = allTxs.filter((t) => !t.isDuplicate);
    const initialExcluded = new Set<number>();
    nonDup.forEach((t, i) => {
      const excludeMatch = checkExcludeRule(t.description, t.amount, merchantRules);
      if (excludeMatch) initialExcluded.add(i);
    });
    if (initialExcluded.size > 0) {
      setExcludedIndices(initialExcluded);
    }
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
      statusByIndex: [],
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
        const statusByIndex: Array<"new" | "exact" | "legacy"> = new Array(hashData.length);

        for (let idx = 0; idx < hashData.length; idx++) {
          const h = hashData[idx];
          if (existingSet.has(h.newHash)) {
            skippedExact++;
            statusByIndex[idx] = "exact";
          } else if (h.legacyHash && existingSet.has(h.legacyHash)) {
            skippedLegacy++;
            statusByIndex[idx] = "legacy";
          } else {
            willImport++;
            newIndices.add(idx);
            statusByIndex[idx] = "new";
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
            statusByIndex,
          });
        }
      } catch {
        if (!cancelled) setDedupCheck(null);
      }
    })();

    return () => { cancelled = true; };
  }, [fileResults, householdId]);

  function analyzeSettlementImpact(batchId: string) {
    const batchTxs = dataCache.transactions.filter(
      (t: Transaction) => t.batch_id === batchId
    );

    if (batchTxs.length === 0) return { settledCount: 0, settlementPaymentCount: 0, affectedMonths: [] as string[], affectedSettlementIds: [] as string[] };

    // Collect months that this batch's transactions fall in (YYYY-MM format)
    const batchMonths = new Set<string>();
    for (const t of batchTxs) {
      if (t.date) batchMonths.add(t.date.slice(0, 7));
    }

    const batchTxIds = new Set(batchTxs.map((t) => t.id));
    let settledCount = 0;
    const affectedMonthsSet = new Set<string>();
    const affectedSettlementIds = new Set<string>();
    const settledMonthsToReopen = new Set<string>();

    for (const settlement of dataCache.settlements) {
      const hasStoredSettledData =
        settlement.is_settled ||
        Boolean(settlement.settlement_batches?.length) ||
        Boolean(settlement.settled_at && settlement.settled_transactions?.length);
      if (!hasStoredSettledData) continue;

      // settlement.month is stored as "YYYY-MM-01"; extract "YYYY-MM"
      const settlementMonth = settlement.month?.slice(0, 7);
      if (!settlementMonth) continue;

      // Check if this settlement's month overlaps with the batch's transaction months
      const monthOverlap = batchMonths.has(settlementMonth);

      // Also check direct transaction ID match (works if IDs haven't changed).
      // `settled_transactions` mirrors the latest batch, so only fall back to it
      // when structured batches are not present to avoid double-counting.
      const matchedTxIds = new Set<string>();
      if (settlement.settlement_batches?.length) {
        for (const batch of settlement.settlement_batches) {
          for (const snap of batch.transactions || []) {
            if (batchTxIds.has(snap.id)) matchedTxIds.add(snap.id);
          }
        }
      } else if (settlement.settled_transactions?.length) {
        for (const snap of settlement.settled_transactions) {
          if (batchTxIds.has(snap.id)) matchedTxIds.add(snap.id);
        }
      }
      const idMatchCount = matchedTxIds.size;

      if (monthOverlap || idMatchCount > 0) {
        settledCount += idMatchCount || 1; // at least 1 for month overlap
        affectedMonthsSet.add(settlement.month);
        affectedSettlementIds.add(settlement.id);
      }
    }

    // Find settlement payment transactions in this batch
    const settlementPaymentCount = batchTxs.filter(
      (t: Transaction) => t.transaction_type === SETTLEMENT_TRANSACTION_TYPE
    ).length;

      if (settlementPaymentCount > 0) {
      const settlementPaymentIds = new Set(
        batchTxs
          .filter((t: Transaction) => t.transaction_type === SETTLEMENT_TRANSACTION_TYPE)
          .map((t) => t.id)
      );

      // 1. Collect months from explicit payment_allocations on the transactions
      for (const t of batchTxs) {
        if (t.transaction_type !== SETTLEMENT_TRANSACTION_TYPE) continue;
        if (t.payment_allocations?.length) {
          for (const alloc of t.payment_allocations) {
            affectedMonthsSet.add(alloc.month);
            settledMonthsToReopen.add(alloc.month.slice(0, 7));
          }
        }
      }

      // 2. Scan all settled settlements for payment_refs that reference these
      //    transactions — this catches months the payment was allocated to even
      //    when the transaction itself doesn't carry payment_allocations.
      for (const settlement of dataCache.settlements) {
        const hasStoredSettledData =
          settlement.is_settled ||
          Boolean(settlement.settlement_batches?.length) ||
          Boolean(settlement.settled_at && settlement.settled_transactions?.length);
        if (!hasStoredSettledData) continue;

        const settlementMonth = settlement.month?.slice(0, 7);
        if (!settlementMonth) continue;

        let referenced = false;
        if (settlement.settlement_batches?.length) {
          for (const batch of settlement.settlement_batches) {
            for (const ref of batch.payment_refs || []) {
              if (settlementPaymentIds.has(ref.transaction_id)) {
                referenced = true;
                break;
              }
            }
            if (referenced) break;
          }
        }

        if (referenced) {
          affectedMonthsSet.add(settlement.month);
          settledMonthsToReopen.add(settlementMonth);
          affectedSettlementIds.add(settlement.id);
        }
      }

      // 3. Fallback: if we found settlement payments but couldn't resolve any
      //    specific months (no allocations, no payment_refs), flag ALL settled
      //    settlements — the payment may have cleared any of them.
      if (settledMonthsToReopen.size === 0) {
        for (const settlement of dataCache.settlements) {
          const hasStoredSettledData =
            settlement.is_settled ||
            Boolean(settlement.settlement_batches?.length) ||
            Boolean(settlement.settled_at && settlement.settled_transactions?.length);
          if (!hasStoredSettledData) continue;

          const settlementMonth = settlement.month?.slice(0, 7);
          if (!settlementMonth) continue;

          affectedMonthsSet.add(settlement.month);
          settledMonthsToReopen.add(settlementMonth);
          affectedSettlementIds.add(settlement.id);
        }
      }
    }

    // Pick up any remaining settled settlements whose months we identified
    if (settledMonthsToReopen.size > 0) {
      for (const settlement of dataCache.settlements) {
        const hasStoredSettledData =
          settlement.is_settled ||
          Boolean(settlement.settlement_batches?.length) ||
          Boolean(settlement.settled_at && settlement.settled_transactions?.length);
        if (!hasStoredSettledData) continue;

        const settlementMonth = settlement.month?.slice(0, 7);
        if (!settlementMonth || !settledMonthsToReopen.has(settlementMonth)) {
          continue;
        }

        affectedSettlementIds.add(settlement.id);
      }
    }

    return {
      settledCount,
      settlementPaymentCount,
      affectedMonths: [...affectedMonthsSet].sort(),
      affectedSettlementIds: [...affectedSettlementIds],
    };
  }

  function handleDeleteBatch(batchId: string) {
    const impact = analyzeSettlementImpact(batchId);

    if ((impact.settledCount > 0 || impact.settlementPaymentCount > 0) && impact.affectedSettlementIds.length > 0) {
      setDeleteBatchDialog({ batchId, ...impact });
      return;
    }

    // No settlement impact — use simple confirm
    if (!confirm("Delete this upload and all its transactions? This cannot be undone.")) {
      return;
    }
    executeDeleteBatch(batchId);
  }

  async function executeDeleteBatch(batchId: string) {
    setDeletingBatchId(batchId);
    try {
      const res = await fetch(`/api/upload-batches/${batchId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setBatches((prev) => prev.filter((b) => b.id !== batchId));
        await dataCache.refreshTransactions();
        await dataCache.refreshSettlements();
        toast.success("Upload batch deleted");
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete batch");
      }
    } catch (err) {
      console.error("[upload] executeDeleteBatch error:", err);
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

        // Auto-categorize and auto-exclude transactions using decrypted merchant rules
        const rules = merchantRulesRef.current;
        if (rules.length > 0) {
          for (const result of results) {
            for (const t of result.transactions) {
              if (!t.autoCategory) {
                t.autoCategory = autoCategorizeImport(
                  t.transaction_type || null,
                  rules
                );
              }
              const excludeMatch = checkExcludeRule(t.description, t.amount, rules);
              if (excludeMatch) {
                t.isExcluded = true;
                t.excludeRuleId = excludeMatch.id;
              }
            }
          }
        }

        // Build initial excludedIndices from exclude rules
        const allParsedTxs = results.flatMap((r) => r.transactions);
        const nonDupTxs = allParsedTxs.filter((t) => !t.isDuplicate);
        const initialExcluded = new Set<number>();
        nonDupTxs.forEach((t, i) => {
          if (t.isExcluded) initialExcluded.add(i);
        });
        setExcludedIndices(initialExcluded);
        setExcludeRuleSaved(new Set());

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
    setExcludedIndices(new Set());
    setExcludeRuleSaved(new Set());
    setDateRange(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function saveExcludeRule(description: string, amount: number, nonDupIndex: number) {
    setSavingExcludeRule(true);
    try {
      // Use the description as the pattern (escaped for regex safety)
      const pattern = description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const encrypted_data = await encryptFields(
        {
          pattern,
          rule_type: "exclude",
          notes: `Auto-created from upload exclusion: "${description}"`,
          merchant_name: null,
          merchant_type: null,
          amount_hint: null,
          amount_max: null,
          match_transaction_type: null,
        },
        ["pattern", "rule_type", "notes", "merchant_name", "merchant_type", "amount_hint", "amount_max", "match_transaction_type"]
      );

      const res = await fetch("/api/merchant-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encrypted_data,
          category_id: null,
          priority: 0,
          is_learned: true,
          owner_user_id: currentUserId || undefined,
        }),
      });

      if (res.ok) {
        const createdRule = await res.json();
        setExcludeRuleSaved((prev) => new Set([...prev, nonDupIndex]));
        // Store the rule ID on the transaction so it can be deleted when toggling back
        setFileResults((prev) =>
          prev.map((result) => ({
            ...result,
            transactions: result.transactions.map((tx) =>
              tx.description === description && tx.amount === amount && !tx.excludeRuleId
                ? { ...tx, excludeRuleId: createdRule.id, isExcluded: true }
                : tx
            ),
          }))
        );
        toast.success(`Exclusion rule saved for "${description.slice(0, 40)}${description.length > 40 ? "…" : ""}"`);
        // Refresh merchant rules so it's immediately available
        const rulesRes = await fetch("/api/merchant-rules");
        if (rulesRes.ok) {
          const dek = getDEK();
          const rawRules = await rulesRes.json();
          const rules = await decryptEntities(rawRules, dek) as unknown as MerchantRule[];
          setMerchantRules(rules);
          merchantRulesRef.current = rules;
        }
      } else {
        toast.error("Failed to save exclusion rule");
      }
    } catch {
      toast.error("Failed to save exclusion rule");
    } finally {
      setSavingExcludeRule(false);
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

    // Filter to truly new ones (excluding user-excluded + outside date range),
    // carrying along their correct occurrence values
    const newWithOcc = dedupCheck && !dedupCheck.loading
      ? nonDupTransactions
          .map((t, i) => ({ t, occ: allOccurrences[i] }))
          .filter(
            (_, i) =>
              dedupCheck.newIndices.has(i) &&
              !excludedIndices.has(i) &&
              !outsideRangeIndices.has(i)
          )
      : nonDupTransactions
          .map((t, i) => ({ t, occ: allOccurrences[i] }))
          .filter((_, i) => !excludedIndices.has(i) && !outsideRangeIndices.has(i));

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
              Generate your own file using our template. Only three fields are
              mandatory — everything else is optional and can be left blank.
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
            <div className="rounded-md border bg-muted/40 p-2.5 text-[11px] space-y-1.5">
              <p className="text-foreground">
                <span className="font-semibold">Mandatory:</span>{" "}
                <code className="rounded bg-background px-1 py-0.5 font-mono">description</code>,{" "}
                <code className="rounded bg-background px-1 py-0.5 font-mono">date</code>{" "}
                <span className="text-muted-foreground">(YYYY-MM-DD)</span>,{" "}
                <code className="rounded bg-background px-1 py-0.5 font-mono">amount</code>
              </p>
              <p className="text-muted-foreground">
                <span className="font-semibold text-foreground">Optional:</span>{" "}
                transaction_type, category, subcategory, tags, notes, bank_name, account_number, account_name
              </p>
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
                  {/* Date range filter */}
                  {preImportStats && (
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="text-xs font-medium text-foreground">
                            Datumperiod att importera
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Välj från- och tilldatum. Transaktioner utanför perioden hoppas över.
                            Filens intervall: {preImportStats.earliest} — {preImportStats.latest}.
                          </p>
                        </div>
                        <DateRangePicker
                          value={dateRange}
                          onChange={setDateRange}
                          defaultMonth={parseISODate(preImportStats.latest)}
                          fromDate={parseISODate(preImportStats.earliest)}
                          toDate={parseISODate(preImportStats.latest)}
                          placeholder="Alla datum"
                        />
                      </div>
                    </div>
                  )}

                  {/* Top-level counts */}
                  {(() => {
                    const hasCheck = dedupCheck && !dedupCheck.loading;
                    const willImport = importableCount;
                    // When a date range is active, all "counts in scope" reflect the range only.
                    const inFileDisplay = rangeFiltered
                      ? rangeFiltered.inFile
                      : allTransactions.length;
                    const dupDisplay = rangeFiltered ? rangeFiltered.duplicates : dupCount;
                    const autoCatDisplay = rangeFiltered ? rangeFiltered.autoCat : autoCatCount;
                    const skippedExactDisplay = rangeFiltered
                      ? rangeFiltered.skippedExact
                      : hasCheck
                        ? dedupCheck.skippedExact
                        : 0;
                    const skippedLegacyDisplay = rangeFiltered
                      ? rangeFiltered.skippedLegacy
                      : hasCheck
                        ? dedupCheck.skippedLegacy
                        : 0;
                    const totalSkipped = skippedExactDisplay + skippedLegacyDisplay;

                    return (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          <div className="rounded-lg border p-3 space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <FileText className="h-3 w-3" />
                              {rangeFiltered ? "In range" : "In file"}
                            </div>
                            <p className="text-lg font-semibold">{inFileDisplay}</p>
                            {rangeFiltered && (
                              <p className="text-[11px] text-muted-foreground">
                                of {allTransactions.length} in file
                              </p>
                            )}
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
                          {importableExcluded > 0 && (
                            <div className="rounded-lg border p-3 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs text-orange-600">
                                <EyeOff className="h-3 w-3" />
                                Excluded
                              </div>
                              <p className="text-lg font-semibold text-orange-600">{importableExcluded}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Private — won&apos;t be shared
                              </p>
                            </div>
                          )}
                          {importableOutsideRange > 0 && (
                            <div className="rounded-lg border p-3 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <CalendarDays className="h-3 w-3" />
                                Outside date range
                              </div>
                              <p className="text-lg font-semibold">{importableOutsideRange}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Filtered out by date
                              </p>
                            </div>
                          )}
                          {hasCheck && totalSkipped > 0 && (
                            <div className="rounded-lg border p-3 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <ShieldCheck className="h-3 w-3" />
                                Already in DB
                              </div>
                              <p className="text-lg font-semibold">{totalSkipped}</p>
                              <div className="space-y-0.5 pt-0.5">
                                {skippedExactDisplay > 0 && (
                                  <p className="text-[11px] text-muted-foreground" title="Exact hash match — this transaction was already imported with the same dedup key">
                                    {skippedExactDisplay} exact match
                                  </p>
                                )}
                                {skippedLegacyDisplay > 0 && (
                                  <p className="text-[11px] text-muted-foreground" title="Matched via old hash format (before account-aware dedup). This was the first occurrence that got imported previously.">
                                    {skippedLegacyDisplay} legacy match
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                          {dupDisplay > 0 && (
                            <div className="rounded-lg border p-3 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Copy className="h-3 w-3" />
                                In-file duplicates
                              </div>
                              <p className="text-lg font-semibold">{dupDisplay}</p>
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

                        {autoCatDisplay > 0 && (
                          <div className="flex items-center gap-1.5 text-xs text-blue-600">
                            <Zap className="h-3 w-3" />
                            {autoCatDisplay} of {willImport} will be auto-categorized by merchant rules
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
                      {(() => {
                        const totalSumDisplay = rangeFiltered
                          ? rangeFiltered.totalSum
                          : preImportStats.totalSum;
                        const rangeLabel = rangeFiltered && (dateRangeFromStr || dateRangeToStr)
                          ? `${dateRangeFromStr ?? "…"} — ${dateRangeToStr ?? "…"}`
                          : `${preImportStats.earliest} — ${preImportStats.latest}`;
                        return (
                          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                            <div>
                              <span className="text-muted-foreground text-xs">
                                {rangeFiltered ? "Selected range" : "Date range"}
                              </span>
                              <p className="font-medium">{rangeLabel}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground text-xs">
                                Total sum (belopp){rangeFiltered ? " — in range" : ""}
                              </span>
                              <p className={`font-mono font-medium ${totalSumDisplay >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {formatCurrency(totalSumDisplay)}
                              </p>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Monthly sums */}
                      {(() => {
                        const monthlySumsDisplay = rangeFiltered
                          ? rangeFiltered.monthlySums
                          : preImportStats.monthlySums;
                        if (monthlySumsDisplay.length === 0) return null;
                        return (
                          <div className="rounded-lg border p-3">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                              <span className="font-medium">
                                Total sum of belopp{rangeFiltered ? " (in range)" : ""}
                              </span>
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
                              {monthlySumsDisplay.map((ms) => {
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
                        );
                      })()}

                      {/* Per-account breakdown */}
                      {(() => {
                        const accountsDisplay = rangeFiltered
                          ? rangeFiltered.accounts
                          : preImportStats.accounts;
                        if (accountsDisplay.length <= 1) return null;
                        return (
                          <div className="rounded-lg border p-3">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                              <Database className="h-3 w-3" />
                              Transactions per account{rangeFiltered ? " (in range)" : " (in file)"}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {accountsDisplay.map((acc) => (
                                <Badge key={acc.name} variant="outline" className="text-xs font-normal">
                                  {acc.name} <span className="ml-1 font-semibold">{acc.count}</span>
                                </Badge>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
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
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={clearAll}
                        disabled={importing}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Discard
                      </Button>
                      <Button
                        onClick={handleImport}
                        disabled={importing || dedupCheck?.loading || importableCount <= 0}
                        size="lg"
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        {importing
                          ? "Importing..."
                          : dedupCheck?.loading
                            ? "Checking..."
                            : `Import ${importableCount} transaction${importableCount !== 1 ? "s" : ""}`}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Preview table — only new transactions when dedup check is done */}
              {(() => {
                const hasCheck = dedupCheck && !dedupCheck.loading;
                const nonDup = allTransactions.filter((t) => !t.isDuplicate);
                // Keep original nonDup index alongside each transaction
                const previewWithIdx = hasCheck
                  ? nonDup.map((t, i) => ({ t, nonDupIdx: i })).filter(({ nonDupIdx }) => dedupCheck.newIndices.has(nonDupIdx))
                  : nonDup.map((t, i) => ({ t, nonDupIdx: i }));
                const previewSorted = [...previewWithIdx].sort((a, b) => b.t.date.localeCompare(a.t.date));
                const previewLabel = hasCheck
                  ? `${previewWithIdx.length} new transactions to import`
                  : `${previewWithIdx.length} transactions`;

                return previewSorted.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          Preview
                          <Badge variant="outline" className="text-xs font-normal">
                            {previewLabel}
                          </Badge>
                        </CardTitle>
                        {importableExcluded > 0 && (
                          <div className="flex items-center gap-1.5 text-xs text-orange-600">
                            <EyeOff className="h-3 w-3" />
                            {importableExcluded} excluded
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[50px]">
                                <span className="flex items-center gap-1 text-xs">
                                  <EyeOff className="h-3 w-3" />
                                  Private
                                </span>
                              </TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Account</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewSorted.map(({ t, nonDupIdx }) => {
                              const isExcluded = excludedIndices.has(nonDupIdx);
                              const isOutsideRange = outsideRangeIndices.has(nonDupIdx);
                              return (
                                <TableRow
                                  key={nonDupIdx}
                                  className={isExcluded || isOutsideRange ? "opacity-40" : ""}
                                >
                                  <TableCell>
                                    <button
                                      type="button"
                                      title={isExcluded ? "Include this transaction" : "Exclude this transaction"}
                                      onClick={async () => {
                                        const wasExcluded = excludedIndices.has(nonDupIdx);
                                        // All same-name transactions in this upload
                                        const sameNameEntries = previewWithIdx
                                          .filter(({ t: other }) => other.description === t.description);
                                        const sameNameIndices = sameNameEntries.map(({ nonDupIdx: idx }) => idx);

                                        if (!wasExcluded) {
                                          // EXCLUDING — exclude ALL same-name + create rule
                                          setExcludedIndices((prev) => {
                                            const next = new Set(prev);
                                            for (const idx of sameNameIndices) next.add(idx);
                                            return next;
                                          });
                                          if (!t.excludeRuleId) {
                                            await saveExcludeRule(t.description, t.amount, nonDupIdx);
                                          }
                                        } else {
                                          // UN-EXCLUDING — only this one transaction
                                          setExcludedIndices((prev) => {
                                            const next = new Set(prev);
                                            next.delete(nonDupIdx);
                                            return next;
                                          });

                                          // Check if this was the last same-name excluded
                                          const othersStillExcluded = sameNameIndices.some(
                                            (idx) => idx !== nonDupIdx && excludedIndices.has(idx)
                                          );

                                          if (!othersStillExcluded) {
                                            // Last one — delete the rule
                                            const ruleIds = new Set<string>();
                                            for (const { t: other } of sameNameEntries) {
                                              if (other.excludeRuleId) ruleIds.add(other.excludeRuleId);
                                            }
                                            for (const deleteId of ruleIds) {
                                              try {
                                                await fetch(`/api/merchant-rules?id=${deleteId}`, { method: "DELETE" });
                                              } catch {
                                                toast.error("Failed to remove exclusion rule");
                                              }
                                            }
                                            if (ruleIds.size > 0) {
                                              setFileResults((prev) =>
                                                prev.map((result) => ({
                                                  ...result,
                                                  transactions: result.transactions.map((tx) =>
                                                    tx.description === t.description
                                                      ? { ...tx, excludeRuleId: undefined, isExcluded: false }
                                                      : tx
                                                  ),
                                                }))
                                              );
                                              const rulesRes = await fetch("/api/merchant-rules");
                                              if (rulesRes.ok) {
                                                const dek = getDEK();
                                                const rawRules = await rulesRes.json();
                                                const rules = await decryptEntities(rawRules, dek) as unknown as MerchantRule[];
                                                setMerchantRules(rules);
                                                merchantRulesRef.current = rules;
                                              }
                                              toast.success("Exclusion rule removed");
                                            }
                                          }
                                          setExcludeRuleSaved((prev) => {
                                            const next = new Set(prev);
                                            next.delete(nonDupIdx);
                                            return next;
                                          });
                                        }
                                      }}
                                      className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                                        isExcluded
                                          ? "border-orange-300 bg-orange-50 text-orange-500 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400 dark:hover:bg-orange-950"
                                          : "border-green-300 bg-green-50 text-green-600 hover:bg-green-100 dark:border-green-800 dark:bg-green-950/50 dark:text-green-400 dark:hover:bg-green-950"
                                      }`}
                                    >
                                      {isExcluded ? (
                                        <EyeOff className="h-3.5 w-3.5" />
                                      ) : (
                                        <Eye className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap">
                                    {t.date.slice(0, 10)}
                                    {isOutsideRange && (
                                      <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                                        <CalendarDays className="mr-1 h-3 w-3" />
                                        Utanför period
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="max-w-[300px] truncate">
                                    {t.description}
                                    {t.autoCategory && !isExcluded && !isOutsideRange && (
                                      <Badge
                                        variant="outline"
                                        className="ml-2 text-xs"
                                      >
                                        {categoryMap.get(t.autoCategory) || "Auto"}
                                      </Badge>
                                    )}
                                    {isExcluded && t.excludeRuleId && (
                                      <Badge variant="outline" className="ml-2 text-xs text-orange-600 border-orange-300">
                                        Auto-excluded
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
                              );
                            })}
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

      {/* Delete blocked — settlements must be reopened first */}
      <Dialog
        open={!!deleteBatchDialog}
        onOpenChange={(open) => {
          if (!open) setDeleteBatchDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Reopen settlements first
            </DialogTitle>
            <DialogDescription>
              This upload contains transactions linked to settled months.
              You must reopen the affected settlements before you can delete this upload.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <ul className="space-y-2 text-sm">
              {(deleteBatchDialog?.settledCount ?? 0) > 0 && (
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded-full bg-amber-100 p-1 dark:bg-amber-900">
                    <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  </span>
                  <span>
                    <strong>{deleteBatchDialog?.settledCount}</strong> transaction{deleteBatchDialog?.settledCount === 1 ? "" : "s"} belong{deleteBatchDialog?.settledCount === 1 ? "s" : ""} to
                    settled month{deleteBatchDialog?.affectedMonths.length === 1 ? "" : "s"}.
                  </span>
                </li>
              )}
              {(deleteBatchDialog?.settlementPaymentCount ?? 0) > 0 && (
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded-full bg-amber-100 p-1 dark:bg-amber-900">
                    <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  </span>
                  <span>
                    <strong>{deleteBatchDialog?.settlementPaymentCount}</strong> settlement payment{deleteBatchDialog?.settlementPaymentCount === 1 ? "" : "s"}{" "}
                    target{deleteBatchDialog?.settlementPaymentCount === 1 ? "s" : ""} settled month{deleteBatchDialog?.affectedMonths.length === 1 ? "" : "s"}.
                  </span>
                </li>
              )}
            </ul>
            {(deleteBatchDialog?.affectedMonths?.length ?? 0) > 0 && (
              <div className="rounded-md border bg-muted/50 p-2.5">
                <p className="text-xs font-medium text-muted-foreground mb-1">Months to reopen</p>
                <div className="flex flex-wrap gap-1.5">
                  {deleteBatchDialog?.affectedMonths.map((m) => (
                    <Badge key={m} variant="outline" className="text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-md border border-amber-200 bg-amber-50/80 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Go to{" "}
              <Link href="/dashboard/settlements" className="font-medium underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-100">
                Settlements
              </Link>{" "}
              and use <strong>Reopen Latest Settled Batch</strong> on each month listed above, then come back to delete this upload.
            </div>
          </div>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" />}
            >
              Cancel
            </DialogClose>
            <Button
              render={<Link href="/dashboard/settlements" />}
            >
              Go to Settlements
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    await dataCache.refreshSettlements();
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
