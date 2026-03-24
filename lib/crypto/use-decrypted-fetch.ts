"use client";

import { useCallback } from "react";
import { useEncryption } from "./encryption-context";
import { getDEK } from "./key-store";
import { decryptData, fromBase64 } from "./client-crypto";

interface RawTransaction {
  encryption_version?: number;
  encrypted_data?: string | null;
  [key: string]: unknown;
}

const SENSITIVE_FIELDS = [
  "description",
  "bank_name",
  "account_number",
  "account_name",
  "notes",
  "enriched_name",
  "enriched_info",
  "enriched_description",
  "enriched_address",
];

/**
 * Decrypt a single transaction's encrypted_data if it's v1.
 * V0 transactions arrive already decrypted from the server.
 */
async function decryptTransaction(
  t: RawTransaction,
  dek: CryptoKey | null
): Promise<RawTransaction> {
  const version = t.encryption_version ?? 0;

  // V0: already decrypted by server
  if (version === 0 || !t.encrypted_data) return t;

  // V1: client-side decryption
  if (!dek) {
    return { ...t, description: "[Encrypted]" };
  }

  try {
    const blob = fromBase64(t.encrypted_data as string);
    const json = await decryptData(blob, dek);
    const sensitive = JSON.parse(json);

    const merged = { ...t };
    for (const key of SENSITIVE_FIELDS) {
      merged[key] = sensitive[key] ?? null;
    }
    return merged;
  } catch (err) {
    console.error("[decryptTransaction] Failed for tx:", t.id ?? "unknown", {
      encryption_version: t.encryption_version,
      has_encrypted_data: !!t.encrypted_data,
      encrypted_data_length: typeof t.encrypted_data === "string" ? t.encrypted_data.length : 0,
      has_dek: !!dek,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...t, description: "[Decryption failed]" };
  }
}

/**
 * Hook that returns a function to fetch transactions and decrypt v1 ones.
 * Usage: const fetchDecrypted = useDecryptedFetch();
 *        const transactions = await fetchDecrypted("/api/transactions?month=2026-03");
 */
export function useDecryptedFetch() {
  const { isUnlocked } = useEncryption();

  return useCallback(
    async (url: string): Promise<unknown[]> => {
      const res = await fetch(url);
      if (!res.ok) return [];

      const data = await res.json();
      const transactions: RawTransaction[] = Array.isArray(data) ? data : [];

      const dek = getDEK();
      if (transactions.length > 0) {
        const v1Count = transactions.filter((t) => t.encryption_version === 1).length;
        console.log("[useDecryptedFetch]", {
          total: transactions.length,
          v1_encrypted: v1Count,
          dek_available: !!dek,
          isUnlocked,
        });
      }
      return Promise.all(
        transactions.map((t) => decryptTransaction(t, dek))
      );
    },
    [isUnlocked]
  );
}

/**
 * Encrypt sensitive fields for a single transaction before sending to the API.
 * Returns the transaction with `encrypted_data` set and sensitive fields removed.
 */
export async function encryptForApi(
  transaction: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { encryptData, toBase64 } = await import("./client-crypto");
  const dek = getDEK();
  if (!dek) throw new Error("Encryption not unlocked");

  const sensitive: Record<string, unknown> = {};
  for (const key of SENSITIVE_FIELDS) {
    sensitive[key] = transaction[key] ?? null;
  }

  const json = JSON.stringify(sensitive);
  const blob = await encryptData(json, dek);

  // Build the API payload with encrypted_data and without plaintext sensitive fields
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(transaction)) {
    if (!SENSITIVE_FIELDS.includes(key)) {
      payload[key] = value;
    }
  }
  payload.encrypted_data = toBase64(blob);

  return payload;
}
