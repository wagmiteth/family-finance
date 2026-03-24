import type { Transaction } from "@/lib/types";
import { decryptData, fromBase64 } from "./client-crypto";

interface RawTransaction {
  id: string;
  household_id: string;
  user_id: string;
  category_id: string | null;
  date: string;
  amount: number;
  transaction_type: string | null;
  subcategory: string | null;
  tags: string[];
  import_hash: string;
  enriched_at: string | null;
  created_at: string;
  updated_at: string;
  encrypted_data: string | null;
  encryption_version: number;
  // Server-decrypted fields (for version 0)
  description?: string;
  bank_name?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  notes?: string | null;
  enriched_name?: string | null;
  enriched_info?: string | null;
  enriched_description?: string | null;
  enriched_address?: string | null;
}

/**
 * Decrypt a list of transactions that may be a mix of
 * server-decrypted (v0) and client-encrypted (v1).
 */
export async function decryptTransactions(
  transactions: RawTransaction[],
  dek: CryptoKey | null
): Promise<Transaction[]> {
  return Promise.all(
    transactions.map((t) => decryptTransaction(t, dek))
  );
}

async function decryptTransaction(
  t: RawTransaction,
  dek: CryptoKey | null
): Promise<Transaction> {
  // Version 0: server already decrypted, fields are present directly
  if (t.encryption_version === 0 || !t.encrypted_data) {
    return t as unknown as Transaction;
  }

  // Version 1: client-side decryption needed
  if (!dek) {
    // Return with placeholder — caller should handle unlock
    return {
      ...t,
      description: "[Encrypted]",
      bank_name: null,
      account_number: null,
      account_name: null,
      notes: null,
      enriched_name: null,
      enriched_info: null,
      enriched_description: null,
      enriched_address: null,
    } as unknown as Transaction;
  }

  try {
    const blob = fromBase64(t.encrypted_data);
    const json = await decryptData(blob, dek);
    const sensitive = JSON.parse(json);

    return {
      ...t,
      description: sensitive.description || "",
      bank_name: sensitive.bank_name || null,
      account_number: sensitive.account_number || null,
      account_name: sensitive.account_name || null,
      notes: sensitive.notes || null,
      enriched_name: sensitive.enriched_name || null,
      enriched_info: sensitive.enriched_info || null,
      enriched_description: sensitive.enriched_description || null,
      enriched_address: sensitive.enriched_address || null,
    } as unknown as Transaction;
  } catch {
    return {
      ...t,
      description: "[Decryption failed]",
      bank_name: null,
      account_number: null,
      account_name: null,
      notes: null,
      enriched_name: null,
      enriched_info: null,
      enriched_description: null,
      enriched_address: null,
    } as unknown as Transaction;
  }
}
