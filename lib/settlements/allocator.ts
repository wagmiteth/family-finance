import type {
  PaymentAllocation,
  Settlement,
  SettlementBatch,
  SettlementPaymentRef,
  Transaction,
} from "@/lib/types";
import type { SettlementBreakdown } from "./calculator";

export interface UnsettledMonth {
  month: string;
  owed: number;
  settlement: Settlement | null;
  breakdown: SettlementBreakdown;
}

export interface AllocationResult {
  allocations: PaymentAllocation[];
  overpayment: number;
}

/**
 * FIFO-allocate a payment amount across unsettled months, oldest first.
 * Returns the per-month allocations and any overpayment remainder.
 */
export function allocatePayment(
  amount: number,
  unsettledMonths: UnsettledMonth[]
): AllocationResult {
  const sorted = [...unsettledMonths].sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  const allocations: PaymentAllocation[] = [];
  let remaining = amount;

  for (const m of sorted) {
    if (remaining < 0.01) break;
    if (m.owed < 0.01) continue;

    const applied = Math.min(remaining, m.owed);
    allocations.push({
      month: m.month,
      amount: Math.round(applied * 100) / 100,
      settlement_id: m.settlement?.id,
    });
    remaining -= applied;
  }

  return {
    allocations,
    overpayment: Math.max(0, Math.round(remaining * 100) / 100),
  };
}

/**
 * Sum all prior payment allocations that target a specific month,
 * across all settlement-type transactions.
 */
export function getPaymentsAppliedToMonth(
  month: string,
  allTransactions: Transaction[]
): number {
  let total = 0;
  for (const tx of allTransactions) {
    if (tx.transaction_type !== "settlement" || !tx.payment_allocations) continue;
    for (const alloc of tx.payment_allocations) {
      if (alloc.month === month) {
        total += alloc.amount;
      }
    }
  }
  return Math.round(total * 100) / 100;
}

/**
 * Build a SettlementPaymentRef from a transaction + allocation amount.
 */
export function buildPaymentRef(
  transaction: Transaction,
  allocatedAmount: number,
  totalOwed: number
): SettlementPaymentRef {
  return {
    transaction_id: transaction.id,
    amount: allocatedAmount,
    date: transaction.date,
    partial: Math.abs(allocatedAmount - totalOwed) > 0.01,
  };
}
