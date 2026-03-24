import type { Transaction, Category, User } from "@/lib/types";

export interface SettlementResult {
  sharedTotal: number;
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

  const user1Paid = sharedTransactions
    .filter((t) => t.user_id === users[0].id)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const user2Paid = sharedTransactions
    .filter((t) => t.user_id === users[1].id)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Positive = user1 overpaid (is owed money)
  const user1Net = user1Paid - user1Owes;

  return {
    sharedTotal,
    user1Paid,
    user2Paid,
    user1Owes,
    user2Owes,
    fromUserId: user1Net < 0 ? users[0].id : users[1].id,
    toUserId: user1Net < 0 ? users[1].id : users[0].id,
    amount: Math.abs(user1Net),
  };
}
