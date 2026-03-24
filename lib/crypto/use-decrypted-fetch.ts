"use client";

import { useCallback } from "react";
import { useEncryption } from "./encryption-context";
import { getDEK } from "./key-store";
import { decryptEntity, encryptFields, TRANSACTION_ENCRYPTED_FIELDS } from "./entity-crypto";

/**
 * Hook that returns a function to fetch and decrypt any entity type.
 * Usage:
 *   const fetchDecrypted = useDecryptedFetch();
 *   const transactions = await fetchDecrypted("/api/transactions");
 */
export function useDecryptedFetch() {
  const { isUnlocked } = useEncryption();

  return useCallback(
    async (url: string): Promise<unknown[]> => {
      const res = await fetch(url);
      if (!res.ok) return [];

      const data = await res.json();
      const rows: Record<string, unknown>[] = Array.isArray(data) ? data : [];

      const dek = getDEK();
      return Promise.all(
        rows.map((row) => decryptEntity(row, dek))
      );
    },
    [isUnlocked]
  );
}

/**
 * Encrypt a transaction's sensitive fields for the API.
 * Returns { encrypted_data, ...plaintext_fields } ready to POST/PATCH.
 */
export async function encryptTransactionForApi(
  transaction: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const dek = getDEK();
  if (!dek) throw new Error("Encryption not unlocked");

  const encrypted_data = await encryptFields(
    transaction,
    TRANSACTION_ENCRYPTED_FIELDS,
    dek
  );

  // Build payload with only server-stored plaintext fields + encrypted blob
  const payload: Record<string, unknown> = {
    user_id: transaction.user_id,
    category_id: transaction.category_id,
    import_hash: transaction.import_hash,
    encrypted_data,
  };

  // Optional fields
  if (transaction.batch_id) payload.batch_id = transaction.batch_id;

  return payload;
}

// Re-export for backward compatibility
export { encryptFields as encryptForApi } from "./entity-crypto";
