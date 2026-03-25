async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate import hash for dedup. Includes account_number and occurrence
 * counter to distinguish truly identical transactions on the same account.
 */
export async function generateImportHash(
  householdId: string,
  date: string,
  amount: number,
  description: string,
  accountNumber?: string,
  occurrence?: number
): Promise<string> {
  const acct = accountNumber?.trim() || "";
  const occ = occurrence && occurrence > 0 ? `|#${occurrence}` : "";
  const input = `${householdId}|${date}|${amount}|${description.toLowerCase().trim()}|${acct}${occ}`;
  return sha256(input);
}

/**
 * Generate the legacy hash (without account_number) so we can check
 * existing transactions that were imported with the old format.
 */
export async function generateLegacyImportHash(
  householdId: string,
  date: string,
  amount: number,
  description: string
): Promise<string> {
  const input = `${householdId}|${date}|${amount}|${description.toLowerCase().trim()}`;
  return sha256(input);
}

/**
 * Build a signature key for counting occurrences of identical transactions.
 */
export function txSignature(
  date: string,
  amount: number,
  description: string,
  accountNumber?: string
): string {
  return `${date}|${amount}|${(description || "").toLowerCase().trim()}|${(accountNumber || "").trim()}`;
}
