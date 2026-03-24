"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Calculator,
  Check,
  Clock,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import type { Settlement, User, Transaction, Category } from "@/lib/types";
import { useDecryptedFetch } from "@/lib/crypto/use-decrypted-fetch";

function formatCurrency(amount: number) {
  return Math.abs(amount).toLocaleString("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Compute the adjustment needed for a settled month that has changed
function getAdjustment(settlement: Settlement, users: User[]) {
  if (
    !settlement.is_settled ||
    settlement.settled_amount === null ||
    settlement.settled_amount === undefined
  ) {
    return null;
  }

  const currentAmount = settlement.amount;
  const settledAmount = settlement.settled_amount;
  const currentFrom = settlement.from_user_id;
  const currentTo = settlement.to_user_id;
  const settledFrom = settlement.settled_from_user_id;
  const settledTo = settlement.settled_to_user_id;

  // Same direction — just a difference in amount
  if (currentFrom === settledFrom && currentTo === settledTo) {
    const diff = currentAmount - settledAmount;
    if (Math.abs(diff) < 1) return null; // no meaningful change

    const fromUser = users.find((u) => u.id === currentFrom);
    const toUser = users.find((u) => u.id === currentTo);

    if (diff > 0) {
      // More owed now — from needs to pay more
      return {
        type: "additional" as const,
        fromUser,
        toUser,
        amount: diff,
        description: `${fromUser?.name} needs to pay ${formatCurrency(diff)} more to ${toUser?.name}`,
      };
    } else {
      // Less owed now — to needs to refund
      return {
        type: "refund" as const,
        fromUser: toUser,
        toUser: fromUser,
        amount: Math.abs(diff),
        description: `${toUser?.name} needs to refund ${formatCurrency(Math.abs(diff))} to ${fromUser?.name}`,
      };
    }
  }

  // Direction reversed — need to undo old + apply new
  if (currentFrom !== settledFrom) {
    const oldFrom = users.find((u) => u.id === settledFrom);
    const oldTo = users.find((u) => u.id === settledTo);
    const newFrom = users.find((u) => u.id === currentFrom);
    const newTo = users.find((u) => u.id === currentTo);

    // The person who paid (settledFrom) already paid settledAmount to settledTo.
    // Now currentFrom owes currentAmount to currentTo.
    // Net: settledTo owes settledAmount back + currentFrom owes currentAmount.
    // If settledTo === currentFrom, net = currentAmount - settledAmount one-way
    const netAmount = settledAmount + currentAmount;

    return {
      type: "reversal" as const,
      fromUser: newFrom,
      toUser: newTo,
      amount: netAmount,
      description: `Direction changed: ${oldTo?.name} should refund ${formatCurrency(settledAmount)}, then ${newFrom?.name} pays ${formatCurrency(currentAmount)} to ${newTo?.name} (net: ${formatCurrency(netAmount)})`,
    };
  }

  return null;
}

function SettlementCard({
  settlement,
  users,
  categories,
  previousSettlement,
  onToggleSettled,
  onAcknowledgeAdjustment,
  onRecalculate,
}: {
  settlement: Settlement;
  users: User[];
  categories: Category[];
  previousSettlement: Settlement | null;
  onToggleSettled: (id: string, isSettled: boolean) => void;
  onAcknowledgeAdjustment: (id: string) => void;
  onRecalculate: (month: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [loadingTx, setLoadingTx] = useState(false);
  const fetchDecrypted = useDecryptedFetch();

  const fromUser = users.find((u) => u.id === settlement.from_user_id);
  const toUser = users.find((u) => u.id === settlement.to_user_id);

  const adjustment = getAdjustment(settlement, users);

  // Check if there's a carry-forward from the previous settled month
  const previousAdjustment = previousSettlement
    ? getAdjustment(previousSettlement, users)
    : null;

  // Get shared category IDs
  const sharedCategoryIds = new Set(
    categories.filter((c) => c.split_type === "equal").map((c) => c.id)
  );

  async function handleExpand() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);

    if (transactions !== null) return;

    setLoadingTx(true);
    try {
      const monthStr = settlement.month.slice(0, 7);
      const allTx = await fetchDecrypted(`/api/transactions?month=${monthStr}`) as Transaction[];
      const sharedTx = allTx.filter(
        (t) => t.category_id && sharedCategoryIds.has(t.category_id)
      );
      setTransactions(sharedTx);
    } catch {
      setTransactions([]);
    } finally {
      setLoadingTx(false);
    }
  }

  const user1 = users[0];
  const user2 = users[1];
  const user1Paid = transactions
    ? transactions
        .filter((t) => t.user_id === user1?.id)
        .reduce((s, t) => s + Math.abs(t.amount), 0)
    : 0;
  const user2Paid = transactions
    ? transactions
        .filter((t) => t.user_id === user2?.id)
        .reduce((s, t) => s + Math.abs(t.amount), 0)
    : 0;

  const monthStr = settlement.month.slice(0, 7);

  return (
    <Card className="animate-fade-up">
      <CardContent className="pt-5 pb-5 px-6">
        {/* Header row */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-heading text-xl font-bold tracking-tight">
              {format(new Date(settlement.month), "MMMM yyyy")}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Shared total: <span className="font-mono font-medium text-foreground">{formatCurrency(settlement.shared_total || 0)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {adjustment && (
              <Badge variant="destructive" className="shrink-0">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Adjusted
              </Badge>
            )}
            <Badge
              variant={settlement.is_settled ? "default" : "secondary"}
              className="shrink-0"
            >
              {settlement.is_settled ? (
                <span className="flex items-center gap-1">
                  <Check className="h-3 w-3" /> Settled
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Pending
                </span>
              )}
            </Badge>
          </div>
        </div>

        {/* Adjustment alert for settled months */}
        {adjustment && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 mb-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Settlement changed after marking as settled
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                  {adjustment.description}
                </p>
                <div className="flex items-center gap-3 mt-2 text-sm">
                  <span className="text-muted-foreground">
                    Was: <span className="font-mono font-medium">{formatCurrency(settlement.settled_amount || 0)}</span>
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="text-foreground">
                    Now: <span className="font-mono font-medium">{formatCurrency(settlement.amount)}</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-6">
              <Button
                size="sm"
                variant="default"
                onClick={() => onAcknowledgeAdjustment(settlement.id)}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                Adjustment Done
              </Button>
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Click after transferring the difference
              </p>
            </div>
          </div>
        )}

        {/* Carry-forward notice from previous month */}
        {previousAdjustment && !settlement.is_settled && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-4 py-3 mb-4">
            <div className="flex items-start gap-2">
              <RefreshCw className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                  Previous month has an unresolved adjustment
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                  You can clear last month&apos;s remaining balance ({formatCurrency(previousAdjustment.amount)}) together with this month&apos;s settlement in one transaction.
                </p>
                {fromUser && toUser && (
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mt-1.5">
                    Combined: {fromUser.name} <ArrowRight className="inline h-3 w-3 mx-1" /> {toUser.name}: <span className="font-mono">{formatCurrency(settlement.amount + previousAdjustment.amount)}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Settlement summary */}
        {settlement.amount > 0 && fromUser && toUser ? (
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 mb-4">
            <span className="text-sm font-medium">{fromUser.name}</span>
            <ArrowRight className="h-3.5 w-3.5 text-warm shrink-0" />
            <span className="text-sm font-medium">{toUser.name}</span>
            <span className="ml-auto font-heading text-lg font-bold">
              {formatCurrency(settlement.amount)}
            </span>
          </div>
        ) : (
          <div className="rounded-lg bg-muted/50 px-4 py-3 mb-4">
            <p className="text-sm text-muted-foreground">All settled — no balance owed</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={settlement.is_settled ? "outline" : "default"}
            size="sm"
            onClick={() =>
              onToggleSettled(settlement.id, !settlement.is_settled)
            }
          >
            {settlement.is_settled ? "Mark as Pending" : "Mark as Settled"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRecalculate(monthStr)}
            title="Recalculate this settlement"
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            Recalculate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExpand}
          >
            {expanded ? (
              <ChevronUp className="mr-1 h-4 w-4" />
            ) : (
              <ChevronDown className="mr-1 h-4 w-4" />
            )}
            {expanded ? "Hide" : "Show"} Breakdown
          </Button>
        </div>

        {/* Expanded breakdown */}
        {expanded && (
          <>
            <Separator className="my-4" />

            {loadingTx ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading transactions...</span>
              </div>
            ) : transactions && transactions.length > 0 ? (
              <div className="space-y-4">
                {/* Per-user paid summary */}
                {user1 && user2 && (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-primary/5 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">{user1.name} paid</p>
                      <p className="font-mono font-semibold">{formatCurrency(user1Paid)}</p>
                    </div>
                    <div className="rounded-md bg-warm/5 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">{user2.name} paid</p>
                      <p className="font-mono font-semibold">{formatCurrency(user2Paid)}</p>
                    </div>
                  </div>
                )}

                {/* Transaction list */}
                <div className="max-h-72 overflow-y-auto space-y-0.5">
                  {transactions
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((t) => {
                      const txUser = users.find((u) => u.id === t.user_id);
                      return (
                        <div
                          key={t.id}
                          className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span className="text-xs text-muted-foreground shrink-0 font-mono w-12">
                              {format(new Date(t.date), "MMM d")}
                            </span>
                            <span className="truncate">
                              {t.enriched_name || t.description}
                            </span>
                            {txUser && (
                              <Badge variant="outline" className="text-[10px] shrink-0 px-1.5 py-0">
                                {txUser.name?.split(" ")[0]}
                              </Badge>
                            )}
                          </div>
                          <span className="font-mono text-sm shrink-0 ml-3 tabular-nums">
                            {formatCurrency(t.amount)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No shared transactions found for this month
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [settRes, catRes, usersRes] = await Promise.all([
        fetch("/api/settlements"),
        fetch("/api/categories"),
        fetch("/api/users"),
      ]);

      if (settRes.ok) setSettlements(await settRes.json());
      if (catRes.ok) setCategories(await catRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleCalculate() {
    setCalculating(true);
    try {
      const month = format(new Date(), "yyyy-MM");
      const res = await fetch("/api/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to calculate settlement");
        return;
      }

      toast.success("Settlement calculated");
      fetchData();
    } catch {
      toast.error("Failed to calculate settlement");
    } finally {
      setCalculating(false);
    }
  }

  async function handleRecalculate(month: string) {
    try {
      const res = await fetch("/api/settlements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to recalculate");
        return;
      }

      toast.success("Settlement recalculated");
      fetchData();
    } catch {
      toast.error("Failed to recalculate settlement");
    }
  }

  async function handleToggleSettled(id: string, isSettled: boolean) {
    try {
      const res = await fetch(`/api/settlements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_settled: isSettled }),
      });

      if (!res.ok) {
        toast.error("Failed to update settlement");
        return;
      }

      const updated = await res.json();
      setSettlements((prev) =>
        prev.map((s) => (s.id === id ? updated : s))
      );

      toast.success(isSettled ? "Marked as settled" : "Marked as pending");
    } catch {
      toast.error("Failed to update settlement");
    }
  }

  async function handleAcknowledgeAdjustment(id: string) {
    try {
      const res = await fetch(`/api/settlements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledge_adjustment: true }),
      });

      if (!res.ok) {
        toast.error("Failed to acknowledge adjustment");
        return;
      }

      const updated = await res.json();
      setSettlements((prev) =>
        prev.map((s) => (s.id === id ? updated : s))
      );

      toast.success("Adjustment acknowledged");
    } catch {
      toast.error("Failed to acknowledge adjustment");
    }
  }

  const sortedSettlements = [...settlements].sort(
    (a, b) => b.month.localeCompare(a.month)
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4 animate-fade-up">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1">
            Monthly
          </p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Settlements</h1>
        </div>
        <Button onClick={handleCalculate} disabled={calculating} className="shrink-0">
          {calculating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Calculator className="mr-2 h-4 w-4" />
          )}
          {calculating ? "Calculating..." : "Calculate Current Month"}
        </Button>
      </div>

      <div className="h-px bg-gradient-to-r from-border via-border to-transparent" />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      ) : sortedSettlements.length === 0 ? (
        <Card className="animate-fade-up">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Calculator className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-heading text-lg font-semibold">No settlements yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Calculate your first settlement to get started
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sortedSettlements.map((s, i) => {
            // Find the previous month's settlement (next in sorted array since sorted desc)
            const prevSettlement = sortedSettlements[i + 1] || null;

            return (
              <div key={s.id} className={`stagger-${Math.min(i + 1, 5)}`}>
                <SettlementCard
                  settlement={s}
                  users={users}
                  categories={categories}
                  previousSettlement={prevSettlement}
                  onToggleSettled={handleToggleSettled}
                  onAcknowledgeAdjustment={handleAcknowledgeAdjustment}
                  onRecalculate={handleRecalculate}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
