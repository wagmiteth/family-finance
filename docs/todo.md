# Future Work — Learning & Categorization System

Remaining items from the full spec (see the original "Family Finance App — Learning & Categorization Prompt" for complete details). The upload/parsing pipeline and multi-file support are implemented — the items below build on top of that foundation.

---

## Account Ownership Mapping UI

**What:** During onboarding (or from settings), each partner claims which bank accounts are "mine" vs "shared". When `data.json` is uploaded, the detected accounts should pre-populate this UI.

**Why it matters:** Account ownership is the highest-priority signal for determining who each expense belongs to. Without it, every transaction on a shared account defaults to "shared" and personal accounts can't be auto-assigned.

**Depends on:** New DB table or column linking accounts to users (e.g. `account_ownership` table with `account_identifier`, `user_id`, `ownership_type`). The upload page already extracts `AccountMetadata` from data.json — this UI would consume that.

---

## Merchant Normalization & 4-Layer Categorization

**What:** A pipeline that cleans raw bank descriptions into canonical merchant names, then auto-categorizes using four layers:

1. **Exact merchant match** — known merchant with consistent category history (confidence 90-100%)
2. **Merchant family match** — fuzzy/prefix match against merchant dictionary (confidence 70-85%)
3. **Behavioral heuristics** — recurring amounts, day-of-month patterns, card-type hints (confidence 50-70%)
4. **Uncategorized** — no signal, requires user input (confidence <50%)

**Why it matters:** The current `autoCategorize()` in `lib/transactions/categorizer.ts` only does regex matching against `merchant_rules`. The spec calls for a much richer system with confidence scoring, progressive learning, and a per-household merchant dictionary.

**Cleaning steps needed:** Strip trailing reference codes, location suffixes, common prefixes (`KORTKÖP`, `CARD PAYMENT`), normalize unicode and casing. Store as `{raw_patterns[] -> canonical_name, default_category, default_owner}`.

**Depends on:** Extending the `merchant_rules` table or adding a `merchant_dictionary` table. Adding a `confidence` column to transactions. UI for reviewing medium/low confidence suggestions.

---

## Owner Detection Logic

**What:** Automatically determine who each expense belongs to (Partner A, Partner B, or Shared) using a priority chain:

1. Account ownership (from mapping above)
2. Explicit tags/notes mentioning a partner's name
3. User overrides (always wins)
4. Learned merchant-to-owner associations
5. Category-based defaults (household configures which categories are shared vs personal)
6. Fallback (personal account = that partner, shared account = shared)

**Why it matters:** The settlement calculation needs to know who owns each expense. Currently `user_id` on transactions tracks who uploaded it, but that's not the same as ownership — one partner might upload shared account data.

**Depends on:** Account ownership mapping, a `owner` + `owner_source` field on transactions (or derived at query time), and an onboarding step where the couple configures shared-vs-personal category defaults.

---

## Cross-Partner Transaction Matching & Dedup

**What:** When both partners upload data from the same shared account, the same transaction appears twice. Detect and deduplicate by matching on `(date, amount, description)`.

**Why it matters:** Double-counting shared expenses would produce incorrect settlement amounts.

**Current state:** `lib/transactions/dedup.ts` generates import hashes per household, but only within a single upload. Cross-partner dedup needs to check existing transactions from the other partner's uploads on the same accounts.

**Depends on:** Account ownership mapping (to know which accounts are shared). May also need fuzzy matching since different bank exports can have slightly different description formatting for the same transaction.

---

## Transfer Detection Between Partners

**What:** A payment from Partner A to Partner B shows up as an expense in A's data and income in B's data. These should be matched and excluded from expense/settlement calculations.

**Why it matters:** Internal transfers aren't real expenses — including them inflates totals and skews the settlement.

**Detection approach:** Match transactions where A has an outgoing amount on date X and B has an incoming amount of the same magnitude on date X (or X+1 for bank processing delay). Mark both as `transaction_type = "transfer"`.

**Depends on:** Both partners having uploaded data. The matching could run as a background job after each upload or as a review step.

---

## Settlement Report Enhancements

**What:** The spec describes a richer monthly report including:

- Category breakdown per person (personal + their share of shared)
- Largest expense categories
- New/uncategorized transactions that need review
- Comparison to previous month

**Current state:** `lib/settlements/calculator.ts` computes the basic "who owes whom" number. The dashboard shows a summary. The full report with category breakdowns and month-over-month comparison is not yet built.

**Depends on:** Owner detection being in place (to split shared vs personal accurately). Category assignment coverage being high enough to produce meaningful breakdowns.

---

## Re-Import Conflict Detection

**What:** When a user re-uploads a Zlantar export with updated data, detect changes:

- **New transactions** — append and run through the learning pipeline
- **Category changes in source** — if Zlantar re-categorized a transaction that the app also categorized, flag the conflict and let the user choose
- **User overrides preserved** — never overwrite `category_source = "user_override"` or `owner_source = "user_override"`

**Why it matters:** Users periodically re-export from Zlantar as new transactions come in. The app needs to handle partial overlaps gracefully without losing manual corrections.

**Current state:** The bulk import API already deduplicates by import hash (skips existing). What's missing is detecting when a previously imported transaction has changed in the source (different category, updated description) and surfacing that as a reviewable conflict rather than silently ignoring it.

**Depends on:** Storing `category_source` on transactions to distinguish imported vs learned vs user-override categories. A conflict resolution UI.
