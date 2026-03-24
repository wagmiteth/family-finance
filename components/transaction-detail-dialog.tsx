"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { encryptTransaction } from "@/lib/crypto/entity-crypto";
import type { Category, Transaction, User } from "@/lib/types";

function formatCurrency(amount: number) {
  return Math.abs(amount).toLocaleString("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatSignedCurrency(amount: number) {
  if (Math.abs(amount) < 0.01) {
    return formatCurrency(0);
  }

  return `${amount > 0 ? "+" : "-"}${formatCurrency(amount)}`;
}

function getAmountClassName(amount: number) {
  return amount >= 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-foreground";
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  if (!value) return null;

  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}

interface TransactionDetailDialogProps {
  transaction: Transaction | null;
  categories: Category[];
  users: User[];
  isFrozen: boolean;
  enriching: boolean;
  onClose: () => void;
  onEnrich: (transaction: Transaction) => void;
  onUpdate: (transaction: Transaction) => void;
}

export function TransactionDetailDialog({
  transaction,
  categories,
  users,
  isFrozen,
  enriching,
  onClose,
  onEnrich,
  onUpdate,
}: TransactionDetailDialogProps) {
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  useEffect(() => {
    if (transaction) {
      setNotes(transaction.notes || "");
      setSelectedCategoryId(transaction.category_id || "");
    }
  }, [transaction]);

  if (!transaction) return null;

  const currentTransaction = transaction;

  const user = users.find((candidate) => candidate.id === currentTransaction.user_id);
  const notesChanged = notes.trim() !== (currentTransaction.notes || "").trim();

  async function handleSaveNotes() {
    if (savingNotes) return;

    const trimmed = notes.trim();
    const original = (currentTransaction.notes || "").trim();
    if (trimmed === original) return;

    setSavingNotes(true);
    try {
      const updated: Transaction = { ...currentTransaction, notes: trimmed || null };
      const encrypted_data = await encryptTransaction(
        updated as unknown as Record<string, unknown>
      );
      const res = await fetch(`/api/transactions/${currentTransaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted_data }),
      });

      if (!res.ok) {
        toast.error("Failed to save note");
        return;
      }

      onUpdate(updated);
      toast.success("Note saved");
    } catch {
      toast.error("Failed to save note");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleCategoryChange(categoryId: string) {
    if (isFrozen) {
      toast.error("Settled transactions are locked. You can still add notes.");
      return;
    }

    setSelectedCategoryId(categoryId);
    try {
      const res = await fetch(`/api/transactions/${currentTransaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: categoryId || null }),
      });

      if (!res.ok) {
        toast.error("Failed to update category");
        return;
      }

      const serverData = await res.json();
      onUpdate({ ...currentTransaction, ...serverData });
      toast.success("Category updated");
    } catch {
      toast.error("Failed to update category");
    }
  }

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 text-lg">
            {currentTransaction.enriched_name || currentTransaction.description}
          </DialogTitle>
          {currentTransaction.enriched_name &&
            currentTransaction.enriched_name !== currentTransaction.description && (
              <DialogDescription className="font-mono text-xs">
                {currentTransaction.description}
              </DialogDescription>
            )}
        </DialogHeader>

        <div className="space-y-4">
          {isFrozen && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              This transaction is part of a settled batch. Payer and category are
              locked, but notes can still be edited.
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-4">
            <div>
              <p
                className={`font-mono text-2xl font-bold ${getAmountClassName(currentTransaction.amount)}`}
              >
                {formatSignedCurrency(currentTransaction.amount)}
              </p>
              <p className="text-sm text-muted-foreground">
                {new Date(currentTransaction.date).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
            {currentTransaction.transaction_type && (
              <Badge variant="secondary">{currentTransaction.transaction_type}</Badge>
            )}
          </div>

          {currentTransaction.enriched_at ? (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                <Sparkles className="h-4 w-4" />
                AI Enriched
              </div>
              <div className="space-y-1">
                <DetailRow label="Merchant" value={currentTransaction.enriched_name} />
                <DetailRow label="Type" value={currentTransaction.enriched_info} />
                {currentTransaction.enriched_description && (
                  <div className="py-1">
                    <p className="text-xs font-medium text-muted-foreground">About</p>
                    <p className="text-sm">{currentTransaction.enriched_description}</p>
                  </div>
                )}
                <DetailRow label="Address" value={currentTransaction.enriched_address} />
              </div>
              <p className="text-xs text-muted-foreground">
                Enriched{" "}
                {new Date(currentTransaction.enriched_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onEnrich(currentTransaction)}
              disabled={enriching}
            >
              {enriching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enriching with AI...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Enrich with AI
                </>
              )}
            </Button>
          )}

          <Separator />

          <div className="space-y-2">
            <DetailRow label="User" value={user?.name} />
            <DetailRow
              label="Category"
              value={
                <select
                  value={selectedCategoryId}
                  onChange={(event) => handleCategoryChange(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  disabled={isFrozen}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.display_name}
                    </option>
                  ))}
                </select>
              }
            />
            <DetailRow label="Subcategory" value={currentTransaction.subcategory} />
            <DetailRow
              label="Tags"
              value={
                currentTransaction.tags && currentTransaction.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {currentTransaction.tags.map((tag, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null
              }
            />
          </div>

          {(currentTransaction.bank_name ||
            currentTransaction.account_number ||
            currentTransaction.account_name) && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Bank Details
                </p>
                <DetailRow label="Bank" value={currentTransaction.bank_name} />
                <DetailRow label="Account" value={currentTransaction.account_name} />
                <DetailRow label="Account #" value={currentTransaction.account_number} />
              </div>
            </>
          )}

          <Separator />
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Notes
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSaveNotes();
                  }
                }}
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Add a note..."
                disabled={savingNotes}
              />
              {notesChanged && (
                <Button
                  size="sm"
                  onClick={() => void handleSaveNotes()}
                  disabled={savingNotes}
                  className="shrink-0"
                >
                  {savingNotes ? "Saving..." : "Save"}
                </Button>
              )}
            </div>
          </div>

          <Separator />
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              Created:{" "}
              {new Date(currentTransaction.created_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {currentTransaction.updated_at !== currentTransaction.created_at && (
              <p>
                Updated:{" "}
                {new Date(currentTransaction.updated_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
            <p className="font-mono text-[10px] opacity-50">ID: {currentTransaction.id}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
