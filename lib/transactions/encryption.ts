/**
 * Helpers for serializing sensitive transaction fields into/from
 * the encrypted JSON blob stored in the `encrypted_data` column.
 */

/** Fields that are stored encrypted in the database */
export interface SensitiveTransactionFields {
  description: string;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  notes: string | null;
  enriched_name: string | null;
  enriched_info: string | null;
  enriched_description: string | null;
  enriched_address: string | null;
}

const SENSITIVE_KEYS: (keyof SensitiveTransactionFields)[] = [
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
 * Build the JSON string that will be encrypted by the DB function.
 * Accepts a flat object (e.g. from a request body) and extracts
 * only the sensitive fields.
 */
export function buildSensitiveJson(
  data: Partial<SensitiveTransactionFields> & { description?: string }
): string {
  const obj: Record<string, string | null> = {};
  for (const key of SENSITIVE_KEYS) {
    obj[key] = data[key] ?? null;
  }
  // description should never be null in practice
  if (!obj.description) obj.description = "";
  return JSON.stringify(obj);
}

/**
 * Given a full transaction row (with sensitive fields already merged
 * from the decrypted JSON by the DB function), extract the sensitive
 * fields into a JSON string for re-encryption during updates.
 */
export function extractSensitiveJson(
  existing: Record<string, unknown>,
  updates: Partial<SensitiveTransactionFields>
): string {
  const merged: Record<string, string | null> = {};
  for (const key of SENSITIVE_KEYS) {
    merged[key] =
      key in updates
        ? (updates[key] as string | null) ?? null
        : (existing[key] as string | null) ?? null;
  }
  if (!merged.description) merged.description = "";
  return JSON.stringify(merged);
}

export { SENSITIVE_KEYS };
