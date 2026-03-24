import type {
  Transaction,
  Category,
  User,
  SettlementTransactionSnapshot,
  SettlementUserSummary,
  SettlementCategorySummary,
} from "@/lib/types";

const EPSILON = 0.01;

type SettlementLikeTransaction = Pick<
  Transaction,
  | "id"
  | "user_id"
  | "category_id"
  | "description"
  | "enriched_name"
  | "amount"
  | "date"
  | "created_at"
>;

export interface SettlementTransfer {
  fromUserId: string | null;
  toUserId: string | null;
  amount: number;
}

export interface SettlementBreakdown {
  sharedTotal: number;
  crossPaidTotal: number;
  relevantTotal: number;
  transactionCount: number;
  users: SettlementUserSummary[];
  categories: SettlementCategorySummary[];
  transfer: SettlementTransfer;
  transactions: SettlementTransactionSnapshot[];
}

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

function clampSplitRatio(splitRatio: number | null | undefined) {
  if (typeof splitRatio !== "number" || Number.isNaN(splitRatio)) {
    return 0.5;
  }

  return Math.min(Math.max(splitRatio, 0), 100) / 100;
}

function toSettlementSnapshot(
  transaction: SettlementLikeTransaction
): SettlementTransactionSnapshot {
  return {
    id: transaction.id,
    user_id: transaction.user_id,
    category_id: transaction.category_id,
    description: transaction.description,
    enriched_name: transaction.enriched_name,
    amount: transaction.amount,
    date: transaction.date,
    created_at: transaction.created_at,
  };
}

function getRelevantKind(
  transaction: SettlementLikeTransaction,
  categoryById: Map<string, Category>,
  participantIds: Set<string>
) {
  if (!transaction.category_id || !transaction.user_id) {
    return null;
  }

  const category = categoryById.get(transaction.category_id);
  if (!category || !participantIds.has(transaction.user_id)) {
    return null;
  }

  if (category.split_type === "equal") {
    return "shared" as const;
  }

  if (
    category.split_type === "full_payer" &&
    category.owner_user_id &&
    participantIds.has(category.owner_user_id) &&
    category.owner_user_id !== transaction.user_id
  ) {
    return "cross_paid" as const;
  }

  return null;
}

function createEmptyBreakdown(users: User[]): SettlementBreakdown {
  return {
    sharedTotal: 0,
    crossPaidTotal: 0,
    relevantTotal: 0,
    transactionCount: 0,
    users: users.map((user) => ({
      userId: user.id,
      paid: 0,
      owes: 0,
      net: 0,
    })),
    categories: [],
    transfer: {
      fromUserId: null,
      toUserId: null,
      amount: 0,
    },
    transactions: [],
  };
}

export function getSettlementParticipants(users: User[]): [User, User] | null {
  if (users.length < 2) {
    return null;
  }

  const sorted = [...users].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );

  return [sorted[0], sorted[1]];
}

export function isSettlementRelevantTransaction(
  transaction: SettlementLikeTransaction,
  categories: Category[],
  users: User[]
) {
  const participants = getSettlementParticipants(users);
  if (!participants) {
    return false;
  }

  return (
    getRelevantKind(
      transaction,
      new Map(categories.map((category) => [category.id, category])),
      new Set(participants.map((user) => user.id))
    ) !== null
  );
}

export function buildSettlementBreakdown(
  transactions: SettlementLikeTransaction[],
  categories: Category[],
  users: User[]
): SettlementBreakdown {
  const participants = getSettlementParticipants(users);
  if (!participants) {
    return createEmptyBreakdown(users);
  }

  const [user1, user2] = participants;
  const participantIds = new Set(participants.map((user) => user.id));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const userTotals = new Map(
    participants.map((user) => [
      user.id,
      {
        paid: 0,
        owes: 0,
      },
    ])
  );

  const categorySummaries = new Map<string, SettlementCategorySummary>();
  const snapshots: SettlementTransactionSnapshot[] = [];

  let sharedTotal = 0;
  let crossPaidTotal = 0;

  for (const transaction of transactions) {
    const kind = getRelevantKind(transaction, categoryById, participantIds);
    if (!kind || !transaction.category_id || !transaction.user_id) {
      continue;
    }

    if (transaction.amount >= 0 && kind !== "shared") {
      continue;
    }

    const category = categoryById.get(transaction.category_id);
    if (!category) {
      continue;
    }

    const amount =
      transaction.amount >= 0 ? -transaction.amount : Math.abs(transaction.amount);
    const snapshot = toSettlementSnapshot(transaction);
    snapshots.push(snapshot);

    const categorySummary =
      categorySummaries.get(category.id) ??
      {
        categoryId: category.id,
        categoryName: category.display_name || category.name || "Uncategorized",
        splitType: kind === "shared" ? "equal" : "full_payer",
        total: 0,
        transactionCount: 0,
        paidByUser: Object.fromEntries(
          participants.map((user) => [user.id, 0])
        ) as Record<string, number>,
        owesByUser: Object.fromEntries(
          participants.map((user) => [user.id, 0])
        ) as Record<string, number>,
      };

    categorySummary.total += amount;
    categorySummary.transactionCount += 1;
    categorySummary.paidByUser[transaction.user_id] =
      (categorySummary.paidByUser[transaction.user_id] ?? 0) + amount;

    const payerTotals = userTotals.get(transaction.user_id);
    if (payerTotals) {
      payerTotals.paid += amount;
    }

    if (kind === "shared") {
      const ratio = clampSplitRatio(category.split_ratio);
      const user1Share = amount * ratio;
      const user2Share = amount - user1Share;

      userTotals.get(user1.id)!.owes += user1Share;
      userTotals.get(user2.id)!.owes += user2Share;
      categorySummary.owesByUser[user1.id] += user1Share;
      categorySummary.owesByUser[user2.id] += user2Share;
      sharedTotal += amount;
    } else if (category.owner_user_id) {
      userTotals.get(category.owner_user_id)!.owes += amount;
      categorySummary.owesByUser[category.owner_user_id] += amount;
      crossPaidTotal += amount;
    }

    categorySummaries.set(category.id, categorySummary);
  }

  const userSummaries = participants.map((user) => {
    const totals = userTotals.get(user.id) ?? { paid: 0, owes: 0 };
    const net = totals.paid - totals.owes;

    return {
      userId: user.id,
      paid: totals.paid,
      owes: totals.owes,
      net,
    };
  });

  const user1Net = userSummaries[0]?.net ?? 0;
  const transfer =
    Math.abs(user1Net) < EPSILON
      ? {
          fromUserId: null,
          toUserId: null,
          amount: 0,
        }
      : user1Net < 0
        ? {
            fromUserId: user1.id,
            toUserId: user2.id,
            amount: Math.abs(user1Net),
          }
        : {
            fromUserId: user2.id,
            toUserId: user1.id,
            amount: user1Net,
          };

  return {
    sharedTotal,
    crossPaidTotal,
    relevantTotal: sharedTotal + crossPaidTotal,
    transactionCount: snapshots.length,
    users: userSummaries,
    categories: [...categorySummaries.values()].sort((a, b) => b.total - a.total),
    transfer,
    transactions: snapshots.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export function calculateSettlement(
  transactions: Transaction[],
  categories: Category[],
  users: [User, User]
): SettlementResult {
  const breakdown = buildSettlementBreakdown(transactions, categories, users);
  const [user1Summary, user2Summary] = breakdown.users;

  return {
    sharedTotal: breakdown.sharedTotal,
    crossPaidTotal: breakdown.crossPaidTotal,
    user1Paid: user1Summary?.paid ?? 0,
    user2Paid: user2Summary?.paid ?? 0,
    user1Owes: user1Summary?.owes ?? 0,
    user2Owes: user2Summary?.owes ?? 0,
    fromUserId: breakdown.transfer.fromUserId ?? users[0].id,
    toUserId: breakdown.transfer.toUserId ?? users[1].id,
    amount: breakdown.transfer.amount,
  };
}

export async function generateSettlementHash(
  householdId: string,
  month: string
) {
  const input = `${householdId}|${month}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
