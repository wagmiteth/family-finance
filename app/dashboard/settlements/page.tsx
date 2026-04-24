"use client";

import { useEffect, useRef, useState } from "react";
import { endOfMonth, format, isWithinInterval, parseISO, startOfMonth } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog";
import { getStoredAnthropicApiKey } from "@/lib/crypto/anthropic-api-key";
import { useData } from "@/lib/crypto/data-provider";
import { encryptSettlement, encryptTransaction } from "@/lib/crypto/entity-crypto";
import {
  buildSettlementBreakdown,
  isSettlementPayment,
  SETTLEMENT_TRANSACTION_TYPE,
  type SettlementBreakdown,
  type SettlementTransfer,
  getSettlementParticipants,
} from "@/lib/settlements/calculator";
import {
  allocatePayment,
  buildPaymentRef,
  getPaymentsAppliedToMonth,
  type UnsettledMonth,
} from "@/lib/settlements/allocator";
import type {
  Category,
  PaymentAllocation,
  Settlement,
  SettlementBatch,
  SettlementPaymentRef,
  SettlementTransactionSnapshot,
  Transaction,
  User,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface MonthlySettlementView {
  month: string;
  record: Settlement | null;
  monthTransactions: Transaction[];
  monthTotal: SettlementBreakdown;
  pending: SettlementBreakdown;
  settledBatches: SettlementBatch[];
  uncategorizedCount: number;
  uncategorizedAmount: number;
  /** Total settlement payments already applied to this month via FIFO */
  paymentsApplied: number;
  /** Remaining owed after subtracting paymentsApplied */
  remainingOwed: number;
}

interface SettlementDetailState {
  transaction: Transaction;
  isFrozen: boolean;
}

function getStoredPaymentsApplied(paymentRefs?: SettlementPaymentRef[] | null) {
  return Math.round(
    (paymentRefs || []).reduce((sum, ref) => sum + ref.amount, 0) * 100
  ) / 100;
}

function getStoredPaymentsAppliedForBatches(settlementBatches: SettlementBatch[]) {
  return Math.round(
    settlementBatches.reduce(
      (sum, batch) => sum + getStoredPaymentsApplied(batch.payment_refs),
      0
    ) * 100
  ) / 100;
}

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

  const prefix = amount > 0 ? "+" : "-";
  return `${prefix}${formatCurrency(amount)}`;
}

function formatSharePercent(share: number, total: number) {
  if (total < 0.01) {
    return "0%";
  }

  const percent = (share / total) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function getAmountTone(amount: number) {
  return amount >= 0
    ? "text-emerald-700 dark:text-emerald-300"
    : "text-muted-foreground";
}

function formatSettlementMetric(amount: number) {
  if (Math.abs(amount) < 0.01) {
    return formatCurrency(0);
  }

  return amount < 0 ? formatSignedCurrency(amount) : formatCurrency(amount);
}

function monthDate(month: string) {
  return parseISO(`${month}-01`);
}

function monthKey(value: string | null | undefined) {
  if (!value) return null;
  return value.slice(0, 7);
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "unknown time";

  try {
    return format(parseISO(value), "MMM d, yyyy HH:mm");
  } catch {
    return value;
  }
}

function formatTransactionDate(value: string) {
  try {
    return format(parseISO(value), "MMM d");
  } catch {
    return value;
  }
}

function compareIso(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return left.localeCompare(right);
  }

  return leftTime - rightTime;
}

function sortTransactionsNewestFirst(
  transactions: SettlementTransactionSnapshot[]
) {
  return [...transactions].sort((left, right) => {
    const byDate = compareIso(right.date, left.date);
    if (byDate !== 0) {
      return byDate;
    }

    return compareIso(right.created_at, left.created_at);
  });
}

function isTransactionInMonth(
  transaction: { date: string },
  month: string
) {
  try {
    const date = parseISO(transaction.date);
    const monthStart = startOfMonth(monthDate(month));
    const monthEnd = endOfMonth(monthDate(month));
    return isWithinInterval(date, { start: monthStart, end: monthEnd });
  } catch {
    return false;
  }
}

function buildStoredBatchBreakdown(
  batch: SettlementBatch,
  categories: Category[],
  users: User[]
) {
  if (batch.users?.length && batch.categories?.length && batch.transactions?.length) {
    const relevantTotal = batch.categories.reduce(
      (sum, category) => sum + category.total,
      0
    );

    return {
      sharedTotal: batch.shared_total || 0,
      crossPaidTotal: Math.max(0, relevantTotal - (batch.shared_total || 0)),
      relevantTotal,
      transactionCount: batch.transactions.length,
      users: batch.users,
      categories: batch.categories,
      transfer: {
        fromUserId: batch.from_user_id,
        toUserId: batch.to_user_id,
        amount: batch.amount,
      },
      transactions: sortTransactionsNewestFirst(batch.transactions),
    };
  }

  return buildSettlementBreakdown(batch.transactions || [], categories, users);
}

function buildLegacyBatch(
  settlement: Settlement,
  currentRelevantTransactions: SettlementTransactionSnapshot[],
  categories: Category[],
  users: User[]
) {
  if (!settlement.is_settled) {
    return null;
  }

  if (
    settlement.settled_at &&
    settlement.settled_users &&
    settlement.settled_categories &&
    settlement.settled_transactions
  ) {
    return {
      id: `legacy-${settlement.id}`,
      settled_at: settlement.settled_at,
      amount: settlement.settled_amount || 0,
      shared_total: settlement.shared_total || 0,
      from_user_id: settlement.settled_from_user_id,
      to_user_id: settlement.settled_to_user_id,
      users: settlement.settled_users,
      categories: settlement.settled_categories,
      transactions: settlement.settled_transactions,
    } satisfies SettlementBatch;
  }

  if (settlement.settled_at) {
    const settledAt = Date.parse(settlement.settled_at);
    const frozenTransactions = currentRelevantTransactions.filter((transaction) => {
      const createdAt = Date.parse(transaction.created_at);
      if (Number.isNaN(settledAt) || Number.isNaN(createdAt)) {
        return false;
      }

      return createdAt <= settledAt;
    });
    const breakdown = buildSettlementBreakdown(frozenTransactions, categories, users);

    return {
      id: `legacy-${settlement.id}`,
      settled_at: settlement.settled_at,
      amount: settlement.settled_amount ?? breakdown.transfer.amount,
      shared_total: settlement.shared_total ?? breakdown.sharedTotal,
      from_user_id: settlement.settled_from_user_id ?? breakdown.transfer.fromUserId,
      to_user_id: settlement.settled_to_user_id ?? breakdown.transfer.toUserId,
      users: breakdown.users,
      categories: breakdown.categories,
      transactions: breakdown.transactions,
    } satisfies SettlementBatch;
  }

  return null;
}

function getStoredBatches(
  settlement: Settlement | null,
  currentRelevantTransactions: SettlementTransactionSnapshot[],
  categories: Category[],
  users: User[]
) {
  if (!settlement || !settlement.is_settled) {
    return [];
  }

  const currentTransactionIds = new Set(
    currentRelevantTransactions.map((transaction) => transaction.id)
  );

  if (settlement.settlement_batches?.length) {
    const sortedBatches = [...settlement.settlement_batches].sort((left, right) =>
      compareIso(left.settled_at, right.settled_at)
    );

    const hasMissingSnapshotTransaction = sortedBatches.some((batch) =>
      batch.transactions.some(
        (transaction) => !currentTransactionIds.has(transaction.id)
      )
    );

    return hasMissingSnapshotTransaction ? [] : sortedBatches;
  }

  const legacyBatch = buildLegacyBatch(
    settlement,
    currentRelevantTransactions,
    categories,
    users
  );

  if (!legacyBatch) {
    return [];
  }

  const hasMissingSnapshotTransaction = legacyBatch.transactions.some(
    (transaction) => !currentTransactionIds.has(transaction.id)
  );

  return hasMissingSnapshotTransaction ? [] : [legacyBatch];
}

function buildSettlementPayload(
  month: string,
  notes: string | null,
  monthTotalTransactions: SettlementTransactionSnapshot[],
  categories: Category[],
  users: User[],
  settlementBatches: SettlementBatch[]
) {
  const includedIds = new Set(
    settlementBatches.flatMap((batch) =>
      batch.transactions.map((transaction) => transaction.id)
    )
  );
  const pendingTransactions = monthTotalTransactions.filter(
    (transaction) => !includedIds.has(transaction.id)
  );
  const pendingBreakdown = buildSettlementBreakdown(
    pendingTransactions,
    categories,
    users
  );
  const latestBatch =
    settlementBatches.length > 0
      ? settlementBatches[settlementBatches.length - 1]
      : null;

  return {
    month: `${month}-01`,
    from_user_id: pendingBreakdown.transfer.fromUserId,
    to_user_id: pendingBreakdown.transfer.toUserId,
    amount: pendingBreakdown.transfer.amount,
    shared_total: pendingBreakdown.sharedTotal,
    notes,
    settled_amount: latestBatch?.amount ?? null,
    settled_from_user_id: latestBatch?.from_user_id ?? null,
    settled_to_user_id: latestBatch?.to_user_id ?? null,
    settled_users: latestBatch?.users ?? null,
    settled_categories: latestBatch?.categories ?? null,
    settled_transactions: latestBatch?.transactions ?? null,
    settlement_batches: settlementBatches.length > 0 ? settlementBatches : null,
  };
}

function buildMonthlySettlementViews(
  settlements: Settlement[],
  transactions: Transaction[],
  categories: Category[],
  users: User[]
) {
  const settlementByMonth = new Map<string, Settlement>();
  for (const settlement of settlements) {
    const currentMonth = monthKey(settlement.month);
    if (currentMonth && !settlementByMonth.has(currentMonth)) {
      settlementByMonth.set(currentMonth, settlement);
    }
  }

  const months = new Set<string>();
  for (const transaction of transactions) {
    const currentMonth = monthKey(transaction.date);
    if (currentMonth) {
      months.add(currentMonth);
    }
  }
  for (const currentMonth of settlementByMonth.keys()) {
    months.add(currentMonth);
  }

  const uncategorizedCategoryIds = new Set(
    categories
      .filter((category) => category.name === "uncategorized")
      .map((category) => category.id)
  );

  // First pass: build views using only explicitly allocated payments
  const views = [...months]
    .map((month) => {
      const monthTransactions = transactions.filter(
        (transaction) =>
          isTransactionInMonth(transaction, month) &&
          !isSettlementPayment(transaction)
      );
      const monthTotal = buildSettlementBreakdown(
        monthTransactions,
        categories,
        users
      );
      const record = settlementByMonth.get(month) ?? null;
      const settledBatches = getStoredBatches(
        record,
        monthTotal.transactions,
        categories,
        users
      );
      const livePaymentsApplied = getPaymentsAppliedToMonth(month, transactions);
      const storedPaymentsApplied = getStoredPaymentsAppliedForBatches(
        settledBatches
      );
      const includedIds = new Set(
        settledBatches.flatMap((batch) =>
          batch.transactions.map((transaction) => transaction.id)
        )
      );
      const pendingTransactions = monthTotal.transactions.filter(
        (transaction) => !includedIds.has(transaction.id)
      );
      const pending = buildSettlementBreakdown(
        pendingTransactions,
        categories,
        users
      );
      const uncategorizedTransactions = monthTransactions.filter(
        (transaction) =>
          !isSettlementPayment(transaction) &&
          (!transaction.category_id ||
            uncategorizedCategoryIds.has(transaction.category_id))
      );

      const paymentsApplied = Math.max(
        livePaymentsApplied,
        storedPaymentsApplied
      );
      const pendingOwed = pending.transfer.amount;
      const remainingOwed = Math.max(0, Math.round((pendingOwed - paymentsApplied) * 100) / 100);

      return {
        month,
        record,
        monthTransactions,
        monthTotal,
        pending,
        settledBatches,
        uncategorizedCount: uncategorizedTransactions.length,
        uncategorizedAmount: uncategorizedTransactions.reduce(
          (sum, transaction) => sum + Math.abs(transaction.amount),
          0
        ),
        paymentsApplied,
        remainingOwed,
      } satisfies MonthlySettlementView;
    })
    .filter(
      (view) =>
        view.monthTransactions.length > 0 ||
        view.settledBatches.length > 0 ||
        view.record
    )
    .sort((left, right) => right.month.localeCompare(left.month));

  // Second pass: auto-allocate unallocated settlement payments (marked from
  // the transactions page without FIFO allocation) against remaining balances.
  // Use the TOTAL month debt (not pending) as the allocation ceiling so that
  // settling a month doesn't cause its share of payments to spill into others.
  const unallocatedPayments = transactions.filter(
    (tx) =>
      tx.transaction_type === "settlement" &&
      (!tx.payment_allocations || tx.payment_allocations.length === 0) &&
      tx.amount > 0
  );

  if (unallocatedPayments.length > 0) {
    // Sort oldest first for stable FIFO
    const sorted = [...unallocatedPayments].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    // Process months oldest-first for FIFO.
    // Track allocation capacity per month using total debt (settled + pending)
    // so that settled months still absorb their share of unallocated payments.
    const monthsAsc = [...views]
      .sort((a, b) => a.month.localeCompare(b.month));

    // Compute each month's total capacity: total debt minus explicitly-allocated payments
    const monthCapacity = new Map<string, number>();
    for (const view of monthsAsc) {
      const totalOwed = view.monthTotal.transfer.amount;
      monthCapacity.set(
        view.month,
        Math.max(0, Math.round((totalOwed - view.paymentsApplied) * 100) / 100)
      );
    }

    for (const tx of sorted) {
      let remaining = Math.abs(tx.amount);
      for (const view of monthsAsc) {
        if (remaining < 0.01) break;
        const capacity = monthCapacity.get(view.month) ?? 0;
        if (capacity < 0.01) continue;

        const applied = Math.min(remaining, capacity);
        monthCapacity.set(view.month, Math.round((capacity - applied) * 100) / 100);

        // Only credit the visible remainingOwed (pending-based)
        const actualCredit = Math.min(applied, view.remainingOwed);
        if (actualCredit > 0) {
          view.paymentsApplied = Math.round((view.paymentsApplied + actualCredit) * 100) / 100;
          view.remainingOwed = Math.max(0, Math.round((view.remainingOwed - actualCredit) * 100) / 100);
        }
        remaining -= applied;
      }
    }
  }

  return views;
}

function TransferSummary({
  transfer,
  users,
  emptyLabel = "All settled",
  amountClassName,
  adjustedAmount,
  adjustedCaption,
}: {
  transfer: SettlementTransfer;
  users: User[];
  emptyLabel?: string;
  amountClassName?: string;
  adjustedAmount?: number;
  adjustedCaption?: string;
}) {
  if (!transfer.fromUserId || !transfer.toUserId || transfer.amount < 0.01) {
    return (
      <div className="rounded-lg bg-muted/60 px-4 py-3">
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  const fromUser = users.find((user) => user.id === transfer.fromUserId);
  const toUser = users.find((user) => user.id === transfer.toUserId);

  if (!fromUser || !toUser) {
    return (
      <div className="rounded-lg bg-muted/60 px-4 py-3">
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  const showAdjustedAmount =
    typeof adjustedAmount === "number" &&
    adjustedAmount >= 0 &&
    Math.abs(adjustedAmount - transfer.amount) > 0.01;

  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/60 px-4 py-3">
      <span className="text-sm font-medium">{fromUser.name}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-warm" />
      <span className="text-sm font-medium">{toUser.name}</span>
      <div className="ml-auto text-right">
        {showAdjustedAmount ? (
          <>
            <p className="text-xs font-medium text-muted-foreground line-through">
              {formatCurrency(transfer.amount)}
            </p>
            <p className={cn("font-heading text-lg font-bold", amountClassName)}>
              {formatCurrency(adjustedAmount)}
            </p>
            {adjustedCaption && (
              <p className="text-xs text-muted-foreground">{adjustedCaption}</p>
            )}
          </>
        ) : (
          <span className={cn("font-heading text-lg font-bold", amountClassName)}>
            {formatCurrency(transfer.amount)}
          </span>
        )}
      </div>
    </div>
  );
}

function UserSummaryGrid({
  breakdown,
  users,
}: {
  breakdown: SettlementBreakdown;
  users: User[];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {breakdown.users.map((summary) => {
        const user = users.find((candidate) => candidate.id === summary.userId);
        const netLabel =
          summary.net < -0.01
            ? "Owes"
            : summary.net > 0.01
              ? "Gets back"
              : "Balanced";
        const netClassName =
          summary.net < -0.01
            ? "text-rose-700 dark:text-rose-300"
            : summary.net > 0.01
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-muted-foreground";

        return (
          <div key={summary.userId} className="rounded-lg border bg-background/80 p-4">
            <p className="text-sm font-semibold">{user?.name || "Unknown user"}</p>
            <div className="mt-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-mono">
                  {formatSettlementMetric(summary.paid)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Own share</span>
                <span className="font-mono">
                  {formatSettlementMetric(summary.owes)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="font-medium">{netLabel}</span>
                <span className={cn("font-mono font-semibold", netClassName)}>
                  {summary.net < 0
                    ? formatCurrency(summary.net)
                    : formatSignedCurrency(summary.net)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategorySummaryList({
  breakdown,
  users,
  frozenTransactionIds,
  highlight,
  onOpenTransaction,
}: {
  breakdown: SettlementBreakdown;
  users: User[];
  frozenTransactionIds: Set<string>;
  highlight?: boolean;
  onOpenTransaction: (
    transaction: SettlementTransactionSnapshot,
    isFrozen: boolean
  ) => void;
}) {
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(
    () => new Set()
  );

  if (breakdown.categories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No settlement categories in this section.
      </p>
    );
  }

  const transactionsByCategory = new Map<string, SettlementTransactionSnapshot[]>();
  for (const transaction of breakdown.transactions) {
    if (!transaction.category_id) {
      continue;
    }

    const current = transactionsByCategory.get(transaction.category_id) || [];
    current.push(transaction);
    transactionsByCategory.set(transaction.category_id, current);
  }

  function toggleCategory(categoryId: string) {
    setExpandedCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {breakdown.categories.map((category) => {
        const categoryTransactions =
          transactionsByCategory.get(category.categoryId) || [];
        const expanded = expandedCategoryIds.has(category.categoryId);

        return (
          <div key={category.categoryId} className="rounded-lg border bg-background/80 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{category.categoryName}</p>
                <p className="text-xs text-muted-foreground">
                  {category.splitType === "equal"
                    ? "Shared split"
                    : "Cross-paid private expense"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {users
                    .map((user) => {
                      const share = category.owesByUser[user.id] || 0;
                      return `${user.name} ${formatSharePercent(
                        share,
                        category.total
                      )}`;
                    })
                    .join(" • ")}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold">
                  {formatSettlementMetric(category.total)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {category.transactionCount} transaction
                  {category.transactionCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {users.map((user) => {
                const share = category.owesByUser[user.id] || 0;

                return (
                  <div
                    key={user.id}
                    className="rounded-md bg-muted/40 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatSharePercent(share, category.total)} share
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Paid</span>
                      <span className="font-mono">
                        {formatSettlementMetric(category.paidByUser[user.id] || 0)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Share</span>
                      <span className="font-mono">
                        {formatSettlementMetric(share)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {categoryTransactions.length} transaction
                {categoryTransactions.length === 1 ? "" : "s"} in this category
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => toggleCategory(category.categoryId)}
              >
                {expanded ? (
                  <ChevronUp className="mr-2 h-4 w-4" />
                ) : (
                  <ChevronDown className="mr-2 h-4 w-4" />
                )}
                {expanded ? "Hide" : "Show"} Transactions
              </Button>
            </div>

            {expanded && (
              <div className="mt-3 space-y-1.5">
                {categoryTransactions.map((transaction) => {
                  const payer = users.find(
                    (user) => user.id === transaction.user_id
                  );
                  const isFrozen = frozenTransactionIds.has(transaction.id);

                  return (
                    <button
                      key={transaction.id}
                      type="button"
                      onClick={() => onOpenTransaction(transaction, isFrozen)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/30",
                        highlight
                          ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
                          : "bg-background/80"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">
                              {formatTransactionDate(transaction.date)}
                            </span>
                            {payer && <span>{payer.name}</span>}
                            {isFrozen && (
                              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                                Settled
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 truncate font-medium">
                            {transaction.enriched_name || transaction.description}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "font-mono font-medium",
                            getAmountTone(transaction.amount)
                          )}
                        >
                          {formatSignedCurrency(transaction.amount)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BreakdownSection({
  title,
  description,
  breakdown,
  users,
  tone = "default",
  frozenTransactionIds,
  onOpenTransaction,
}: {
  title: string;
  description: string;
  breakdown: SettlementBreakdown;
  users: User[];
  tone?: "default" | "warning";
  frozenTransactionIds: Set<string>;
  onOpenTransaction: (
    transaction: SettlementTransactionSnapshot,
    isFrozen: boolean
  ) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-4",
        tone === "warning"
          ? "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20"
          : "bg-muted/30"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant={tone === "warning" ? "destructive" : "secondary"}>
          {breakdown.transactionCount} tx
        </Badge>
      </div>

      <div className="mt-4 space-y-4">
        <TransferSummary
          transfer={breakdown.transfer}
          users={users}
          emptyLabel="No balance in this section"
          amountClassName={
            tone === "warning" ? "text-amber-700 dark:text-amber-300" : undefined
          }
        />

        <UserSummaryGrid breakdown={breakdown} users={users} />

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Categories
          </p>
          <CategorySummaryList
            breakdown={breakdown}
            users={users}
            frozenTransactionIds={frozenTransactionIds}
            highlight={tone === "warning"}
            onOpenTransaction={onOpenTransaction}
          />
        </div>
      </div>
    </div>
  );
}

function SettledBatchCard({
  batch,
  batchNumber,
  categories,
  users,
  onOpenTransaction,
}: {
  batch: SettlementBatch;
  batchNumber: number;
  categories: Category[];
  users: User[];
  onOpenTransaction: (
    transaction: SettlementTransactionSnapshot,
    isFrozen: boolean
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const breakdown = buildStoredBatchBreakdown(batch, categories, users);
  const paymentsApplied = getStoredPaymentsApplied(batch.payment_refs);
  const remainingAfterPayments = Math.max(
    0,
    Math.round((breakdown.transfer.amount - paymentsApplied) * 100) / 100
  );
  const frozenTransactionIds = new Set(
    batch.transactions.map((transaction) => transaction.id)
  );

  return (
    <div className="rounded-xl border bg-background/70 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Settled Batch {batchNumber}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Locked on {formatTimestamp(batch.settled_at)}
          </p>
        </div>
        <Badge variant="default">
          <Check className="mr-1 h-3 w-3" />
          Settled
        </Badge>
      </div>

      <div className="mt-3">
        <TransferSummary
          transfer={breakdown.transfer}
          users={users}
          emptyLabel="This batch was balanced"
          adjustedAmount={paymentsApplied > 0.01 ? remainingAfterPayments : undefined}
          adjustedCaption={
            paymentsApplied > 0.01
              ? remainingAfterPayments > 0.01
                ? "still remaining"
                : "fully paid"
              : undefined
          }
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {breakdown.transactionCount} transactions in this settled batch.
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <ChevronUp className="mr-2 h-4 w-4" />
          ) : (
            <ChevronDown className="mr-2 h-4 w-4" />
          )}
          {expanded ? "Hide" : "Show"} Batch Details
        </Button>
      </div>

      {expanded && (
        <div className="mt-4">
          <BreakdownSection
            title={`Settled Batch ${batchNumber}`}
            description="These numbers were frozen at the time this batch was settled."
            breakdown={breakdown}
            users={users}
            frozenTransactionIds={frozenTransactionIds}
            onOpenTransaction={onOpenTransaction}
          />
        </div>
      )}
    </div>
  );
}

function SettlementCard({
  busy,
  categories,
  onOpenTransaction,
  onReopenLatestBatch,
  onSettleCurrentBatch,
  users,
  view,
}: {
  busy: boolean;
  categories: Category[];
  onOpenTransaction: (
    transaction: SettlementTransactionSnapshot,
    isFrozen: boolean
  ) => void;
  onReopenLatestBatch: (view: MonthlySettlementView) => Promise<void>;
  onSettleCurrentBatch: (view: MonthlySettlementView) => Promise<void>;
  users: User[];
  view: MonthlySettlementView;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPending = view.pending.transactionCount > 0;
  const hasUncategorized = view.uncategorizedCount > 0;
  const settledMonthRemaining = Math.max(
    0,
    Math.round((view.monthTotal.transfer.amount - view.paymentsApplied) * 100) / 100
  );
  const showSettledPaymentAdjustment =
    !hasPending &&
    view.paymentsApplied > 0.01 &&
    view.monthTotal.transfer.amount > 0.01;
  const visibleRemainingOwed = showSettledPaymentAdjustment
    ? settledMonthRemaining
    : view.remainingOwed;
  const settledTransactionIds = new Set(
    view.settledBatches.flatMap((batch) =>
      batch.transactions.map((transaction) => transaction.id)
    )
  );

  return (
    <Card className="animate-fade-up">
      <CardContent className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-heading text-xl font-bold tracking-tight">
              {format(monthDate(view.month), "MMMM yyyy")}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {view.settledBatches.length} settled batch
              {view.settledBatches.length === 1 ? "" : "es"} in this month
            </p>
          </div>

          <div className="flex items-center gap-2">
            {hasUncategorized && (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Uncategorized
              </Badge>
            )}
            <Badge variant={hasPending ? "secondary" : "default"}>
              {hasPending ? (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Pending Batch
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  Up To Date
                </span>
              )}
            </Badge>
          </div>
        </div>

        <div className="mt-4 rounded-xl border bg-muted/30 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Month Total
          </p>
          <div className="mt-3">
            <TransferSummary
              transfer={view.monthTotal.transfer}
              users={users}
              emptyLabel="The month is balanced overall"
              adjustedAmount={
                showSettledPaymentAdjustment ? settledMonthRemaining : undefined
              }
              adjustedCaption={
                showSettledPaymentAdjustment
                  ? settledMonthRemaining > 0.01
                    ? "still remaining"
                    : "fully paid"
                  : undefined
              }
            />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-background/80 px-3 py-3">
              <p className="text-xs text-muted-foreground">Net settlement activity</p>
              <p className="mt-1 font-mono font-semibold">
                {formatSettlementMetric(view.monthTotal.relevantTotal)}
              </p>
            </div>
            <div className="rounded-lg bg-background/80 px-3 py-3">
              <p className="text-xs text-muted-foreground">Settlement transactions</p>
              <p className="mt-1 font-mono font-semibold">
                {view.monthTotal.transactionCount}
              </p>
            </div>
            <div className="rounded-lg bg-background/80 px-3 py-3">
              <p className="text-xs text-muted-foreground">Remaining owed</p>
              <p className="mt-1 font-mono font-semibold">
                {formatCurrency(visibleRemainingOwed)}
              </p>
            </div>
          </div>
        </div>

        {hasUncategorized && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-4 dark:border-amber-900 dark:bg-amber-950/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Categorize all transactions before settling this month
                </p>
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                  {view.uncategorizedCount} uncategorized transaction
                  {view.uncategorizedCount === 1 ? "" : "s"} worth{" "}
                  {formatCurrency(view.uncategorizedAmount)} still need a category.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-4 dark:border-blue-900 dark:bg-blue-950/20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-800 dark:text-blue-300">
            Current Pending Batch
          </p>
          <div className="mt-3">
            <TransferSummary
              transfer={view.pending.transfer}
              users={users}
              emptyLabel="No new settlement-affecting transactions since the last settled batch"
              amountClassName="text-blue-800 dark:text-blue-300"
              adjustedAmount={view.paymentsApplied > 0.01 ? view.remainingOwed : undefined}
              adjustedCaption={
                view.paymentsApplied > 0.01
                  ? view.remainingOwed > 0.01
                    ? "still remaining"
                    : "fully paid"
                  : undefined
              }
            />
          </div>
          <p className="mt-2 text-sm text-blue-800 dark:text-blue-300">
            {hasPending
              ? `${view.pending.transactionCount} transactions are waiting to be settled as the next batch.`
              : "Newly imported transactions in this month will appear here as a separate batch."}
          </p>

          {view.paymentsApplied > 0.01 && (
            <div className="mt-3 rounded-lg bg-emerald-50/80 px-3 py-2 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
                  <Banknote className="h-3.5 w-3.5" />
                  Payments applied
                </span>
                <span className="font-mono font-semibold text-emerald-800 dark:text-emerald-300">
                  {formatCurrency(view.paymentsApplied)}
                </span>
              </div>
              {view.remainingOwed <= 0.01 && (
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                  This month is fully paid
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void onSettleCurrentBatch(view)}
            disabled={busy || !hasPending || hasUncategorized}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Mark Current Batch as Settled
          </Button>
          {view.settledBatches.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onReopenLatestBatch(view)}
              disabled={busy}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reopen Latest Settled Batch
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <ChevronUp className="mr-2 h-4 w-4" />
            ) : (
              <ChevronDown className="mr-2 h-4 w-4" />
            )}
            {expanded ? "Hide" : "Show"} Details
          </Button>
        </div>

        {expanded && (
          <>
            <Separator className="my-4" />

            <div className="space-y-4">
              <BreakdownSection
                title="Month Total"
                description="This is the full month summary across every settlement batch and the current pending batch."
                breakdown={view.monthTotal}
                users={users}
                frozenTransactionIds={settledTransactionIds}
                onOpenTransaction={onOpenTransaction}
              />

              <BreakdownSection
                title="Current Pending Batch"
                description="These are the transactions that would be frozen if you settle the month right now."
                breakdown={view.pending}
                users={users}
                tone="warning"
                frozenTransactionIds={new Set()}
                onOpenTransaction={onOpenTransaction}
              />

              {view.settledBatches.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Settled Batches
                  </p>
                  {[...view.settledBatches]
                    .reverse()
                    .map((batch, index) => (
                      <SettledBatchCard
                        key={batch.id}
                        batch={batch}
                        batchNumber={view.settledBatches.length - index}
                        categories={categories}
                        users={users}
                        onOpenTransaction={onOpenTransaction}
                      />
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SettlementPaymentsPanel({
  transactions,
  users,
  hasOutstanding,
  onRecordPayment,
  onOpenTransaction,
}: {
  transactions: Transaction[];
  users: User[];
  hasOutstanding: boolean;
  onRecordPayment: () => void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const settlementPayments = transactions
    .filter((tx) => tx.transaction_type === SETTLEMENT_TRANSACTION_TYPE)
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalPaid = settlementPayments.reduce(
    (sum, tx) => sum + Math.abs(tx.amount),
    0
  );

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-4 dark:border-emerald-900 dark:bg-emerald-950/20">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              Settlement Payments
            </p>
          </div>
          {hasOutstanding ? (
            <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              Mark an incoming transfer as a settlement payment to track it against outstanding months.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              All months are currently settled. Record a payment when new expenses arise.
            </p>
          )}
        </div>
        <Button
          onClick={onRecordPayment}
          size="sm"
          className="shrink-0 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-700"
        >
          <Banknote className="mr-2 h-4 w-4" />
          Record Payment
        </Button>
      </div>

      {settlementPayments.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded((c) => !c)}
            className="flex w-full items-center justify-between rounded-lg bg-emerald-100/70 px-3 py-2 text-sm transition-colors hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50"
          >
            <span className="font-medium text-emerald-800 dark:text-emerald-300">
              {settlementPayments.length} payment
              {settlementPayments.length === 1 ? "" : "s"} recorded
              <span className="ml-2 font-mono">
                ({formatCurrency(totalPaid)} total)
              </span>
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            )}
          </button>

          {expanded && (
            <div className="mt-2 space-y-1.5">
              {settlementPayments.map((tx) => {
                const payer = users.find((u) => u.id === tx.user_id);
                const allocCount = tx.payment_allocations?.length ?? 0;

                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => onOpenTransaction(tx)}
                    className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-left text-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">
                            {formatTransactionDate(tx.date)}
                          </span>
                          {payer && <span>{payer.name}</span>}
                          {allocCount > 0 && (
                            <Badge
                              variant="outline"
                              className="h-4 border-emerald-300 px-1 text-[9px] text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
                            >
                              {allocCount} month{allocCount === 1 ? "" : "s"}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 truncate font-medium">
                          {tx.enriched_name || tx.description}
                        </p>
                        {tx.payment_allocations && tx.payment_allocations.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                            {tx.payment_allocations.map((alloc) => (
                              <span key={alloc.month} className="font-mono">
                                {alloc.month}: {formatCurrency(alloc.amount)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 font-mono font-semibold text-emerald-800 dark:text-emerald-300">
                        {formatCurrency(tx.amount)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettlementPaymentDialog({
  open,
  onClose,
  transactions,
  monthlyViews,
  onConfirm,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  transactions: Transaction[];
  monthlyViews: MonthlySettlementView[];
  onConfirm: (transaction: Transaction, allocations: PaymentAllocation[]) => Promise<void>;
  busy: boolean;
}) {
  const [selectedTxId, setSelectedTxId] = useState<string>("");
  const [customAmount, setCustomAmount] = useState<string>("");

  // Find candidate transactions: positive amounts (incoming transfers) that aren't already marked as settlement
  const candidates = transactions.filter(
    (tx) =>
      tx.amount > 0 &&
      tx.transaction_type !== SETTLEMENT_TRANSACTION_TYPE
  ).sort((a, b) => b.date.localeCompare(a.date));

  const selectedTx = candidates.find((tx) => tx.id === selectedTxId) ?? null;
  const paymentAmount = customAmount
    ? parseFloat(customAmount)
    : selectedTx?.amount ?? 0;

  // Build unsettled months from views where pending transfer has a direction
  const unsettledMonths: UnsettledMonth[] = monthlyViews
    .filter((view) => view.remainingOwed > 0.01 && view.pending.transfer.fromUserId)
    .map((view) => ({
      month: view.month,
      owed: view.remainingOwed,
      settlement: view.record,
      breakdown: view.pending,
    }));

  const allocation = paymentAmount > 0
    ? allocatePayment(paymentAmount, unsettledMonths)
    : { allocations: [], overpayment: 0 };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record Settlement Payment</DialogTitle>
          <DialogDescription>
            Select an incoming transfer to mark as a settlement payment. The amount will be
            applied to the oldest unsettled months first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Select transaction</label>
            <select
              value={selectedTxId}
              onChange={(e) => {
                setSelectedTxId(e.target.value);
                setCustomAmount("");
              }}
              aria-label="Select transaction"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Choose a transaction...</option>
              {candidates.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {tx.date} — {tx.enriched_name || tx.description} — {formatCurrency(tx.amount)}
                </option>
              ))}
            </select>
          </div>

          {selectedTx && (
            <>
              <div>
                <label className="text-sm font-medium">
                  Amount to apply
                </label>
                <p className="text-xs text-muted-foreground">
                  Transaction total: {formatCurrency(selectedTx.amount)}. Leave blank to use full amount.
                </p>
                <input
                  type="number"
                  min="0.01"
                  max={selectedTx.amount}
                  step="0.01"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder={selectedTx.amount.toFixed(2)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                />
              </div>

              {allocation.allocations.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Allocation Preview
                  </p>
                  {allocation.allocations.map((alloc) => {
                    const view = monthlyViews.find((v) => v.month === alloc.month);
                    const fullyClears = view
                      ? Math.abs(alloc.amount - view.remainingOwed) < 0.01
                      : false;

                    return (
                      <div
                        key={alloc.month}
                        className="flex items-center justify-between text-sm"
                      >
                        <span>{format(monthDate(alloc.month), "MMMM yyyy")}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">
                            {formatCurrency(alloc.amount)}
                          </span>
                          <Badge variant={fullyClears ? "default" : "secondary"} className="text-[10px]">
                            {fullyClears ? "Fully clears" : "Partial"}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                  {allocation.overpayment > 0.01 && (
                    <div className="flex items-center justify-between text-sm text-amber-700 dark:text-amber-300">
                      <span>Overpayment (not allocated)</span>
                      <span className="font-mono font-medium">
                        {formatCurrency(allocation.overpayment)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {unsettledMonths.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No unsettled months to apply this payment to.
                </p>
              )}
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                busy ||
                !selectedTx ||
                allocation.allocations.length === 0 ||
                paymentAmount < 0.01
              }
              onClick={() => {
                if (selectedTx) {
                  void onConfirm(selectedTx, allocation.allocations);
                }
              }}
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Banknote className="mr-2 h-4 w-4" />
              )}
              Apply Payment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SettlementsPage() {
  const {
    categories,
    household,
    loading: dataLoading,
    refreshSettlements,
    refreshTransactions,
    settlements,
    transactions,
    updateTransactions,
    users,
    lastFetched,
  } = useData();

  const [busyMonth, setBusyMonth] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<SettlementDetailState | null>(
    null
  );
  const [enriching, setEnriching] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [applyingPayment, setApplyingPayment] = useState(false);
  const [settlementToggling, setSettlementToggling] = useState(false);
  const didRefreshRef = useRef(false);
  const participants = getSettlementParticipants(users);
  const loading = dataLoading && lastFetched === 0;

  useEffect(() => {
    if (didRefreshRef.current) return;
    didRefreshRef.current = true;
    void Promise.all([refreshTransactions(), refreshSettlements()]);
  }, [refreshSettlements, refreshTransactions]);

  const monthlyViews = participants
    ? buildMonthlySettlementViews(settlements, transactions, categories, participants)
    : [];

  // Net outstanding uses remainingOwed (pending transfer minus payments applied)
  const outstandingNet = participants
    ? monthlyViews.reduce((sum, view) => {
        const pending = view.pending.transfer;
        if (!pending.fromUserId || !pending.toUserId || pending.amount < 0.01) return sum;
        const remaining = view.remainingOwed;
        if (remaining < 0.01) return sum;
        const signed = pending.toUserId === participants[0].id ? remaining : -remaining;
        return sum + signed;
      }, 0)
    : 0;

  const totalOutstandingTransfer: SettlementTransfer = participants
    ? Math.abs(outstandingNet) < 0.01
      ? { fromUserId: null, toUserId: null, amount: 0 }
      : outstandingNet > 0
        ? {
            fromUserId: participants[1].id,
            toUserId: participants[0].id,
            amount: outstandingNet,
          }
        : {
            fromUserId: participants[0].id,
            toUserId: participants[1].id,
            amount: Math.abs(outstandingNet),
          }
    : { fromUserId: null, toUserId: null, amount: 0 };

  const pendingMonths = monthlyViews.filter(
    (view) => view.pending.transactionCount > 0
  ).length;
  const settledBatches = monthlyViews.reduce(
    (sum, view) => sum + view.settledBatches.length,
    0
  );
  const blockedMonths = monthlyViews.filter(
    (view) => view.uncategorizedCount > 0
  ).length;

  function handleOpenTransaction(
    transaction: SettlementTransactionSnapshot,
    isFrozen: boolean
  ) {
    const liveTransaction = transactions.find(
      (candidate) => candidate.id === transaction.id
    );

    if (!liveTransaction) {
      toast.error("Could not load the full transaction details");
      return;
    }

    setDetailState({ transaction: liveTransaction, isFrozen });
  }

  async function handleEnrichTransaction(transaction: Transaction) {
    setEnriching(true);

    try {
      const apiKey = await getStoredAnthropicApiKey();
      if (!apiKey) {
        toast.error("No API key configured. Add one in Settings.");
        return;
      }

      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          transactionIds: [transaction.id],
          descriptions: [{ id: transaction.id, name: transaction.description, amount: transaction.amount }],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to enrich");
        return;
      }

      const enrichData = await res.json();
      if (enrichData.enriched <= 0 || !enrichData.results?.[0]) {
        toast.error("Enrichment failed");
        return;
      }

      const result = enrichData.results[0];
      const updated: Transaction = {
        ...transaction,
        enriched_name: result.merchant_name ?? transaction.enriched_name,
        enriched_info: result.merchant_type ?? transaction.enriched_info,
        enriched_description: result.merchant_description ?? transaction.enriched_description,
        enriched_address: result.merchant_address ?? transaction.enriched_address,
        enriched_at: new Date().toISOString(),
      };

      // Encrypt and save back to server
      const encrypted_data = await encryptTransaction(
        updated as unknown as Record<string, unknown>
      );
      await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted_data }),
      });

      updateTransactions((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate
        )
      );
      setDetailState((current) =>
        current ? { ...current, transaction: updated } : current
      );
      toast.success("Transaction enriched");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to enrich transaction"
      );
    } finally {
      setEnriching(false);
    }
  }

  function handleUpdateTransaction(updated: Transaction) {
    updateTransactions((current) =>
      current.map((transaction) =>
        transaction.id === updated.id ? updated : transaction
      )
    );
    setDetailState((current) =>
      current ? { ...current, transaction: updated } : current
    );
  }

  async function upsertSettlementMonth(
    view: MonthlySettlementView,
    settlementBatches: SettlementBatch[]
  ) {
    if (!participants || !household?.id) {
      throw new Error("Missing household data");
    }

    const encryptedData = await encryptSettlement(
      buildSettlementPayload(
        view.month,
        view.record?.notes || null,
        view.monthTotal.transactions,
        categories,
        participants,
        settlementBatches
      )
    );

    const latestBatch =
      settlementBatches.length > 0
        ? settlementBatches[settlementBatches.length - 1]
        : null;

    const res = await fetch(
      view.record ? `/api/settlements/${view.record.id}` : "/api/settlements",
      {
        method: view.record ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encrypted_data: encryptedData,
          is_settled: settlementBatches.length > 0,
          settled_at: latestBatch?.settled_at ?? null,
        }),
      }
    );

    if (!res.ok) {
      throw new Error("Failed to save settlement");
    }
  }

  async function handleSettleCurrentBatch(view: MonthlySettlementView) {
    if (!participants) {
      toast.error("Add both users before creating settlements");
      return;
    }

    if (!household?.id) {
      toast.error("Household not loaded");
      return;
    }

    if (view.uncategorizedCount > 0) {
      toast.error("Categorize all transactions in this month before settling");
      return;
    }

    if (view.pending.transactionCount === 0) {
      toast.error("There is no pending batch to settle");
      return;
    }

    setBusyMonth(view.month);

    try {
      const totalOwedBeforePayments = Math.round(
        (view.remainingOwed + view.paymentsApplied) * 100
      ) / 100;
      const paymentRefs = transactions
        .filter(
          (transaction) =>
            transaction.transaction_type === SETTLEMENT_TRANSACTION_TYPE &&
            transaction.payment_allocations?.some((allocation) => allocation.month === view.month)
        )
        .flatMap((transaction) =>
          (transaction.payment_allocations || [])
            .filter((allocation) => allocation.month === view.month)
            .map((allocation) =>
              buildPaymentRef(
                transaction,
                allocation.amount,
                totalOwedBeforePayments
              )
            )
        );

      const newBatch: SettlementBatch = {
        id: crypto.randomUUID(),
        settled_at: new Date().toISOString(),
        amount: view.pending.transfer.amount,
        shared_total: view.pending.sharedTotal,
        from_user_id: view.pending.transfer.fromUserId,
        to_user_id: view.pending.transfer.toUserId,
        users: view.pending.users,
        categories: view.pending.categories,
        transactions: view.pending.transactions,
        payment_refs: paymentRefs.length > 0 ? paymentRefs : undefined,
      };

      await upsertSettlementMonth(view, [...view.settledBatches, newBatch]);
      await refreshSettlements();
      toast.success("Current batch settled");
    } catch {
      toast.error("Failed to settle current batch");
    } finally {
      setBusyMonth(null);
    }
  }

  async function handleReopenLatestBatch(view: MonthlySettlementView) {
    if (view.settledBatches.length === 0) {
      toast.error("There is no settled batch to reopen");
      return;
    }

    setBusyMonth(view.month);

    try {
      const nextBatches = view.settledBatches.slice(0, -1);
      await upsertSettlementMonth(view, nextBatches);
      await refreshSettlements();
      toast.success("Latest settled batch reopened");
    } catch {
      toast.error("Failed to reopen latest batch");
    } finally {
      setBusyMonth(null);
    }
  }

  async function handleApplySettlementPayment(
    transaction: Transaction,
    allocations: PaymentAllocation[]
  ) {
    if (!participants) return;

    setApplyingPayment(true);
    try {
      // Update the transaction: set type to "settlement" and store allocations
      const updated: Transaction = {
        ...transaction,
        transaction_type: SETTLEMENT_TRANSACTION_TYPE,
        payment_allocations: allocations,
      };
      const encrypted_data = await encryptTransaction(
        updated as unknown as Record<string, unknown>
      );
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted_data }),
      });

      if (!res.ok) {
        toast.error("Failed to save settlement payment");
        return;
      }

      updateTransactions((current) =>
        current.map((tx) => (tx.id === updated.id ? updated : tx))
      );

      setPaymentDialogOpen(false);
      toast.success(
        `Payment applied across ${allocations.length} month${allocations.length === 1 ? "" : "s"}`
      );
    } catch {
      toast.error("Failed to apply settlement payment");
    } finally {
      setApplyingPayment(false);
    }
  }

  async function handleToggleSettlement(transaction: Transaction) {
    if (!participants) return;

    const isCurrentlySettlement =
      transaction.transaction_type === SETTLEMENT_TRANSACTION_TYPE;

    if (!isCurrentlySettlement && transaction.amount < 0.01) {
      toast.error("Only positive (incoming) transactions can be settlement payments");
      return;
    }

    setSettlementToggling(true);
    try {

      let updated: Transaction;
      if (isCurrentlySettlement) {
        // Unmark: restore original transaction_type and clear allocations
        updated = {
          ...transaction,
          transaction_type: null,
          payment_allocations: null,
        };
      } else {
        // Mark: FIFO-allocate the transaction amount
        const unsettled: UnsettledMonth[] = monthlyViews
          .filter(
            (view) =>
              view.remainingOwed > 0.01 && view.pending.transfer.fromUserId
          )
          .map((view) => ({
            month: view.month,
            owed: view.remainingOwed,
            settlement: view.record,
            breakdown: view.pending,
          }));

        const { allocations } = allocatePayment(
          Math.abs(transaction.amount),
          unsettled
        );

        updated = {
          ...transaction,
          transaction_type: SETTLEMENT_TRANSACTION_TYPE,
          payment_allocations: allocations.length > 0 ? allocations : null,
        };
      }

      const encrypted_data = await encryptTransaction(
        updated as unknown as Record<string, unknown>
      );
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted_data }),
      });

      if (!res.ok) {
        toast.error("Failed to update transaction");
        return;
      }

      updateTransactions((current) =>
        current.map((tx) => (tx.id === updated.id ? updated : tx))
      );
      setDetailState((current) =>
        current ? { ...current, transaction: updated } : current
      );

      toast.success(
        isCurrentlySettlement
          ? "Transaction unmarked as settlement payment"
          : "Transaction marked as settlement payment"
      );
    } catch {
      toast.error("Failed to update transaction");
    } finally {
      setSettlementToggling(false);
    }
  }

  if (loading || !participants) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Loading settlements...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="animate-fade-up">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Monthly
            </p>
            <h1 className="font-heading text-3xl font-bold tracking-tight">
              Settlements
            </h1>
          </div>
        </div>
        <div className="mt-3 h-px bg-gradient-to-r from-border via-border to-transparent" />

        <SettlementPaymentsPanel
          transactions={transactions}
          users={participants}
          hasOutstanding={totalOutstandingTransfer.amount > 0.01}
          onRecordPayment={() => setPaymentDialogOpen(true)}
          onOpenTransaction={(tx) =>
            setDetailState({ transaction: tx, isFrozen: false })
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="animate-fade-up stagger-1 md:col-span-2">
          <CardContent className="px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Total Outstanding
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Net across the currently open batch in every month. Shared
              positive income or refunds reduce the shared settlement total.
            </p>
            <div className="mt-4">
              <TransferSummary
                transfer={totalOutstandingTransfer}
                users={participants}
                emptyLabel="Everything is currently settled"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-up stagger-2">
          <CardContent className="grid gap-4 px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Pending Months
              </p>
              <p className="mt-1 font-heading text-2xl font-bold">{pendingMonths}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Settled Batches
              </p>
              <p className="mt-1 font-heading text-2xl font-bold">{settledBatches}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Blocked By Uncategorized
              </p>
              <p className="mt-1 font-heading text-2xl font-bold">{blockedMonths}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {monthlyViews.length === 0 ? (
        <Card className="animate-fade-up">
          <CardContent className="px-6 py-14">
            <p className="font-heading text-lg font-semibold">No settlements yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              As soon as shared or cross-paid transactions exist, monthly settlement
              summaries will show up here automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {monthlyViews.map((view, index) => (
            <div key={view.month} className={`stagger-${Math.min(index + 1, 5)}`}>
              <SettlementCard
                busy={busyMonth === view.month}
                categories={categories}
                onOpenTransaction={handleOpenTransaction}
                onReopenLatestBatch={handleReopenLatestBatch}
                onSettleCurrentBatch={handleSettleCurrentBatch}
                users={participants}
                view={view}
              />
            </div>
          ))}
        </div>
      )}

      <TransactionDetailDialog
        transaction={detailState?.transaction ?? null}
        categories={categories}
        users={participants}
        isFrozen={detailState?.isFrozen ?? false}
        enriching={enriching}
        onClose={() => setDetailState(null)}
        onEnrich={handleEnrichTransaction}
        onUpdate={handleUpdateTransaction}
        onToggleSettlement={handleToggleSettlement}
        settlementToggling={settlementToggling}
      />

      <SettlementPaymentDialog
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        transactions={transactions}
        monthlyViews={monthlyViews}
        onConfirm={handleApplySettlementPayment}
        busy={applyingPayment}
      />
    </div>
  );
}
