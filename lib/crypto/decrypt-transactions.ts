import type { Transaction, RawTransaction } from "@/lib/types";
import { decryptFields } from "./entity-crypto";

/**
 * Decrypt a list of raw transaction rows into full Transaction objects.
 */
export async function decryptTransactions(
  transactions: RawTransaction[],
  dek: CryptoKey | null
): Promise<Transaction[]> {
  if (!dek) {
    return transactions.map((t) => ({
      ...t,
      description: "[Encrypted]",
      amount: 0,
      date: "",
      transaction_type: null,
      subcategory: null,
      tags: null,
      notes: null,
      bank_name: null,
      account_number: null,
      account_name: null,
      enriched_name: null,
      enriched_info: null,
      enriched_description: null,
      enriched_address: null,
      enriched_at: null,
    })) as unknown as Transaction[];
  }

  return Promise.all(
    transactions.map(async (t) => {
      if (!t.encrypted_data) return t as unknown as Transaction;
      try {
        const decrypted = await decryptFields(t.encrypted_data, dek);
        return { ...t, ...decrypted } as unknown as Transaction;
      } catch {
        return {
          ...t,
          description: "[Decryption failed]",
          amount: 0,
          date: "",
        } as unknown as Transaction;
      }
    })
  );
}
