"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseFiles } from "@/lib/transactions/parser";
import { autoCategorizeImport } from "@/lib/transactions/categorizer";
import { encryptTransaction, encryptFields, decryptEntities, decryptEntity } from "@/lib/crypto/entity-crypto";
import { getDEK } from "@/lib/crypto/key-store";
import { generateImportHash } from "@/lib/transactions/dedup";
import { hasDEK } from "@/lib/crypto/key-store";
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
} from "lucide-react";
import { toast } from "sonner";
import type {
  ParsedTransaction,
  FileParseResult,
  AccountMetadata,
  User,
  MerchantRule,
  FileFormat,
} from "@/lib/types";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileResults, setFileResults] = useState<FileParseResult[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const merchantRulesRef = useRef<MerchantRule[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [householdId, setHouseholdId] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);

  // Derived state
  const allTransactions = fileResults.flatMap((r) => r.transactions);
  const allAccounts = fileResults.flatMap((r) => r.accounts);
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

  useEffect(() => {
    async function fetchUsers() {
      try {
        const dek = getDEK();
        const [usersRes, userRes, rulesRes] = await Promise.all([
          fetch("/api/users"),
          fetch("/api/user"),
          fetch("/api/merchant-rules"),
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

    const newTransactions = allTransactions.filter((t) => !t.isDuplicate);
    if (newTransactions.length === 0) {
      toast.error("No new transactions to import");
      return;
    }

    setImporting(true);
    try {
      // Generate import hashes and encrypt each transaction
      const txPayload = await Promise.all(
        newTransactions.map(async (t) => {
          const import_hash = t.import_hash || await generateImportHash(
            householdId,
            t.date,
            t.amount,
            t.description || "encrypted"
          );
          const encrypted_data = await encryptTransaction(
            t as unknown as Record<string, unknown>
          );
          return {
            encrypted_data,
            import_hash,
            category_id: t.autoCategory ?? null,
          };
        })
      );

      // Encrypt batch metadata (file names)
      const encrypted_batch = await encryptFields(
        { file_names: fileResults.map((r) => r.fileName) },
        ["file_names"]
      );

      const res = await fetch("/api/transactions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: txPayload,
          user_id: selectedUserId,
          encrypted_batch,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to import");
        return;
      }

      const data = await res.json();
      toast.success(
        `Imported ${data.imported || newTransactions.length} transactions` +
          (data.duplicates > 0
            ? ` (${data.duplicates} duplicates skipped)`
            : "")
      );
      clearAll();
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

          {/* Transaction summary + import button */}
          {allTransactions.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 p-4">
                <Badge variant="default">{newCount} new</Badge>
                <span className="text-xs text-muted-foreground">— you can edit and recategorize after importing</span>
                {dupCount > 0 && (
                  <Badge variant="secondary">{dupCount} duplicates</Badge>
                )}
                {autoCatCount > 0 && (
                  <Badge variant="outline">
                    {autoCatCount} auto-categorized
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-3">
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
                  <Button
                    onClick={handleImport}
                    disabled={importing || newCount === 0}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {importing
                      ? "Importing..."
                      : `Import ${newCount} transactions`}
                  </Button>
                </div>
              </div>

              {/* Preview table */}
              <Card>
                <CardHeader>
                  <CardTitle>Preview</CardTitle>
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
                          <TableHead>Source</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...allTransactions].sort((a, b) => b.date.localeCompare(a.date)).map((t, i) => (
                          <TableRow
                            key={i}
                            className={t.isDuplicate ? "opacity-50" : ""}
                          >
                            <TableCell className="whitespace-nowrap">
                              {t.date}
                            </TableCell>
                            <TableCell className="max-w-[300px] truncate">
                              {t.description}
                              {t.autoCategory && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 text-xs"
                                >
                                  Auto
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
                                  {t.bank_name}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {t.isDuplicate ? (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <AlertCircle className="h-3.5 w-3.5" />
                                  <span className="text-xs">Duplicate</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-green-600">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span className="text-xs">New</span>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {/* Upload History */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Upload History</CardTitle>
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Files</TableHead>
                    <TableHead>Payer</TableHead>
                    <TableHead className="text-right">Imported</TableHead>
                    <TableHead className="text-right">Duplicates</TableHead>
                    <TableHead>Uploaded By</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(batch.created_at).toLocaleDateString("sv-SE")}{" "}
                        <span className="text-muted-foreground">
                          {new Date(batch.created_at).toLocaleTimeString("sv-SE", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {batch.file_names && batch.file_names.length > 0 ? (
                            batch.file_names.map((fname: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {fname}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {users.find((u) => u.id === batch.user_id)?.name || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {batch.transaction_count}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {batch.duplicate_count}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {users.find((u) => u.id === batch.uploaded_by)?.name || "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={deletingBatchId === batch.id}
                          onClick={() => handleDeleteBatch(batch.id)}
                        >
                          {deletingBatchId === batch.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
