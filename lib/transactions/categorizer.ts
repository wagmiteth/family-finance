import type { MerchantRule } from "@/lib/types";

export function autoCategorize(
  description: string,
  amount: number,
  rules: MerchantRule[]
): string | null {
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    try {
      const regex = new RegExp(rule.pattern, "i");
      if (!regex.test(description)) continue;

      if (rule.amount_hint !== null) {
        const diff = Math.abs(Math.abs(amount) - Math.abs(rule.amount_hint));
        if (diff > 5) continue;
      }

      if (rule.amount_max !== null && Math.abs(amount) > Math.abs(rule.amount_max)) {
        continue;
      }

      return rule.category_id;
    } catch {
      // Invalid regex pattern, skip
      if (description.toLowerCase().includes(rule.pattern.toLowerCase())) {
        return rule.category_id;
      }
    }
  }

  return null;
}
