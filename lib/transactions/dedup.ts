export async function generateImportHash(
  householdId: string,
  date: string,
  amount: number,
  description: string
): Promise<string> {
  const input = `${householdId}|${date}|${amount}|${description.toLowerCase().trim()}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
