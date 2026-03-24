import type { Transaction, Category, User } from "@/lib/types";

export interface SettlementResult {
  sharedTotal: number;
  crossPaidTotal: number;
  user1Paid: number;
  user2Paid: number;
  user1Owes: number;
  user2Owes: number;
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export function calculateSettlement(
  transactions: Transaction[],
  categories: Category[],
  users: [User, User]
): SettlementResult {
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  // --- 1. Shared (equal-split) transactions ---
  const sharedCategoryIds = new Set(
    categories
      .filter((c) => c.split_type === "equal")
      .map((c) => c.id)
  );

  const sharedTransactions = transactions.filter(
    (t) => t.category_id && sharedCategoryIds.has(t.category_id)
  );

  const sharedTotal = sharedTransactions.reduce(
    (sum, t) => sum + Math.abs(t.amount),
    0
  );

  // Calculate what each user owes based on per-category split ratios
  let user1Owes = 0;
  let user2Owes = 0;

  for (const t of sharedTransactions) {
    const cat = categoryById.get(t.category_id!);
    const ratio = (cat?.split_ratio ?? 50) / 100;
    const absAmount = Math.abs(t.amount);
    user1Owes += absAmount * ratio;
    user2Owes += absAmount * (1 - ratio);
  }

  const user1PaidShared = sharedTransactions
    .filter((t) => t.user_id === users[0].id)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const user2PaidShared = sharedTransactions
    .filter((t) => t.user_id === users[1].id)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // --- 2. Cross-paid full_payer transactions ---
  // A full_payer transaction where the payer (user_id) differs from the
  // category owner (owner_user_id) means someone paid for the other person's
  // private expense. The owner owes the payer 100% of the amount.
  const crossPaidTransactions = transactions.filter((t) => {
    if (!t.category_id || !t.user_id) return false;
    const cat = categoryById.get(t.category_id);
    return (
      cat?.split_type === "full_payer" &&
      cat.owner_user_id != null &&
      cat.owner_user_id !== t.user_id
    );
  });

  const crossPaidTotal = crossPaidTransactions.reduce(
    (sum, t) => sum + Math.abs(t.amount),
    0
  );

  // Cross-paid amounts: if user1 paid for user2's private category,
  // user2 owes user1 that full amount (and vice versa).
  const user1PaidCross = crossPaidTransactions
    .filter((t) => t.user_id === users[0].id)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const user2PaidCross = crossPaidTransactions
    .filter((t) => t.user_id === users[1].id)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Add cross-paid to what each user owes:
  // user1 paid for user2's private stuff → user2 owes that amount
  user2Owes += user1PaidCross;
  // user2 paid for user1's private stuff → user1 owes that amount
  user1Owes += user2PaidCross;

  // Total each user actually paid (shared + cross-paid)
  const user1Paid = user1PaidShared + user1PaidCross;
  const user2Paid = user2PaidShared + user2PaidCross;

  // Positive = user1 overpaid (is owed money)
  const user1Net = user1Paid - user1Owes;

  return {
    sharedTotal,
    crossPaidTotal,
    user1Paid,
    user2Paid,
    user1Owes,
    user2Owes,
    fromUserId: user1Net < 0 ? users[0].id : users[1].id,
    toUserId: user1Net < 0 ? users[1].id : users[0].id,
    amount: Math.abs(user1Net),
  };
}
