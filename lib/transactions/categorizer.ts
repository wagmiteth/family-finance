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
 * Auto-categorize during import. Only checks auto_import rules (transaction_type matching).
 * Pattern rules are applied separately via manual "Auto-sort" on the transactions page.
 */
export function autoCategorizeImport(
  transactionType: string | null,
  rules: MerchantRule[]
): string | null {
  const autoImportRules = rules
    .filter((r) => r.rule_type === "auto_import")
    .sort((a, b) => b.priority - a.priority);

  for (const rule of autoImportRules) {
    if (
      rule.match_transaction_type &&
      transactionType &&
      transactionType.toLowerCase() === rule.match_transaction_type.toLowerCase()
    ) {
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

/**
 * Check if a transaction should be excluded during import.
 * Returns the matching exclude rule if found, null otherwise.
 */
export function checkExcludeRule(
  description: string,
  amount: number,
  rules: MerchantRule[]
): MerchantRule | null {
  const excludeRules = rules
    .filter((r) => r.rule_type === "exclude")
    .sort((a, b) => b.priority - a.priority);

  for (const rule of excludeRules) {
    if (matchPatternRule(rule, description, amount)) {
      return rule;
    }
  }

  return null;
}
