import type { MerchantRule } from "@/lib/types";

/**
 * Match a transaction against pattern-based rules (description matching).
 * Used by both import and manual auto-sort.
 */
function matchPatternRule(
  rule: MerchantRule,
  description: string,
  amount: number
): boolean {
  try {
    const regex = new RegExp(rule.pattern, "i");
    if (!regex.test(description)) return false;
  } catch {
    // Invalid regex — try substring match
    if (!description.toLowerCase().includes(rule.pattern.toLowerCase())) {
      return false;
    }
  }

  if (rule.amount_hint !== null) {
    const diff = Math.abs(Math.abs(amount) - Math.abs(rule.amount_hint));
    if (diff > 5) return false;
  }

  if (rule.amount_max !== null && Math.abs(amount) > Math.abs(rule.amount_max)) {
    return false;
  }

  return true;
}

/**
 * Auto-categorize during import. Checks both auto_import rules (transaction_type matching)
 * and pattern rules (description matching). Auto-import rules are evaluated first.
 */
export function autoCategorizeImport(
  description: string,
  amount: number,
  transactionType: string | null,
  rules: MerchantRule[]
): string | null {
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  // First pass: auto_import rules (match on transaction_type)
  for (const rule of sortedRules) {
    if (rule.rule_type !== "auto_import") continue;

    if (
      rule.match_transaction_type &&
      transactionType &&
      transactionType.toLowerCase() === rule.match_transaction_type.toLowerCase()
    ) {
      return rule.category_id;
    }
  }

  // Second pass: pattern rules (match on description)
  for (const rule of sortedRules) {
    if (rule.rule_type !== "pattern") continue;

    if (matchPatternRule(rule, description, amount)) {
      return rule.category_id;
    }
  }

  return null;
}

/**
 * Auto-categorize using pattern rules only.
 * Used for manual auto-sort on the transactions page.
 */
export function autoCategorize(
  description: string,
  amount: number,
  rules: MerchantRule[]
): string | null {
  const patternRules = rules.filter((r) => r.rule_type === "pattern");
  const sortedRules = [...patternRules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    if (matchPatternRule(rule, description, amount)) {
      return rule.category_id;
    }
  }

  return null;
}
