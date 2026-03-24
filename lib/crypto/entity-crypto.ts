"use client";

/**
 * Generic entity encryption/decryption for zero-knowledge storage.
 * All sensitive fields are packed into a JSON blob, encrypted with the DEK,
 * and stored as a base64 string in the `encrypted_data` column.
 */

import { encryptData, decryptData, toBase64, fromBase64 } from "./client-crypto";
import { getDEK } from "./key-store";

// --- Field definitions for each entity type ---

/** Transaction fields stored in encrypted_data */
const TRANSACTION_ENCRYPTED_FIELDS = [
  "description",
  "amount",
  "date",
  "transaction_type",
  "subcategory",
  "tags",
  "notes",
  "bank_name",
  "account_number",
  "account_name",
  "enriched_name",
  "enriched_info",
  "enriched_description",
  "enriched_address",
  "enriched_at",
] as const;

/** Category fields stored in encrypted_data */
const CATEGORY_ENCRYPTED_FIELDS = [
  "name",
  "display_name",
  "description",
  "split_type",
  "split_ratio",
  "color",
] as const;

/** User fields stored in encrypted_data */
const USER_ENCRYPTED_FIELDS = ["name", "avatar_url"] as const;

/** Household fields stored in encrypted_data */
const HOUSEHOLD_ENCRYPTED_FIELDS = ["name"] as const;

/** Merchant rule fields stored in encrypted_data */
const MERCHANT_RULE_ENCRYPTED_FIELDS = [
  "pattern",
  "merchant_name",
  "merchant_type",
  "amount_hint",
  "amount_max",
  "notes",
  "rule_type",
  "match_transaction_type",
] as const;

/** Settlement fields stored in encrypted_data */
const SETTLEMENT_ENCRYPTED_FIELDS = [
  "month",
  "from_user_id",
  "to_user_id",
  "amount",
  "shared_total",
  "notes",
  "settled_amount",
  "settled_from_user_id",
  "settled_to_user_id",
  "settled_users",
  "settled_categories",
  "settled_transactions",
  "settlement_batches",
] as const;

// --- Generic encrypt/decrypt ---

/**
 * Encrypt an object's fields into a base64 encrypted_data string.
 */
export async function encryptFields(
  data: Record<string, unknown>,
  fields: readonly string[],
  dek?: CryptoKey | null
): Promise<string> {
  const key = dek ?? getDEK();
  if (!key) throw new Error("Encryption not unlocked");

  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    payload[field] = data[field] ?? null;
  }

  const json = JSON.stringify(payload);
  const blob = await encryptData(json, key);
  return toBase64(blob);
}

/**
 * Decrypt a base64 encrypted_data string into fields.
 */
export async function decryptFields(
  encryptedData: string,
  dek?: CryptoKey | null
): Promise<Record<string, unknown>> {
  const key = dek ?? getDEK();
  if (!key) throw new Error("Encryption not unlocked");

  const blob = fromBase64(encryptedData);
  const json = await decryptData(blob, key);
  return JSON.parse(json);
}

// --- Entity-specific helpers ---

export async function encryptTransaction(
  data: Record<string, unknown>,
  dek?: CryptoKey | null
): Promise<string> {
  return encryptFields(data, TRANSACTION_ENCRYPTED_FIELDS, dek);
}

export async function encryptCategory(
  data: Record<string, unknown>,
  dek?: CryptoKey | null
): Promise<string> {
  return encryptFields(data, CATEGORY_ENCRYPTED_FIELDS, dek);
}

export async function encryptUser(
  data: Record<string, unknown>,
  dek?: CryptoKey | null
): Promise<string> {
  return encryptFields(data, USER_ENCRYPTED_FIELDS, dek);
}

export async function encryptHousehold(
  data: Record<string, unknown>,
  dek?: CryptoKey | null
): Promise<string> {
  return encryptFields(data, HOUSEHOLD_ENCRYPTED_FIELDS, dek);
}

export async function encryptMerchantRule(
  data: Record<string, unknown>,
  dek?: CryptoKey | null
): Promise<string> {
  return encryptFields(data, MERCHANT_RULE_ENCRYPTED_FIELDS, dek);
}

export async function encryptSettlement(
  data: Record<string, unknown>,
  dek?: CryptoKey | null
): Promise<string> {
  return encryptFields(data, SETTLEMENT_ENCRYPTED_FIELDS, dek);
}

/**
 * Decrypt a raw DB row and merge decrypted fields onto it.
 * Returns the merged object with both plaintext DB fields and decrypted fields.
 */
export async function decryptEntity<T extends Record<string, unknown>>(
  raw: T & { encrypted_data?: string | null },
  dek?: CryptoKey | null
): Promise<T> {
  if (!raw.encrypted_data) return raw;

  try {
    const decrypted = await decryptFields(raw.encrypted_data, dek);
    return { ...raw, ...decrypted };
  } catch {
    return raw;
  }
}

/**
 * Decrypt an array of raw DB rows.
 */
export async function decryptEntities<T extends Record<string, unknown>>(
  rows: (T & { encrypted_data?: string | null })[],
  dek?: CryptoKey | null
): Promise<T[]> {
  return Promise.all(rows.map((row) => decryptEntity(row, dek)));
}

// Re-export field lists for tests/other uses
export {
  TRANSACTION_ENCRYPTED_FIELDS,
  CATEGORY_ENCRYPTED_FIELDS,
  USER_ENCRYPTED_FIELDS,
  HOUSEHOLD_ENCRYPTED_FIELDS,
  MERCHANT_RULE_ENCRYPTED_FIELDS,
  SETTLEMENT_ENCRYPTED_FIELDS,
};
