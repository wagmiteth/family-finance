-- Add rule_type to distinguish auto-import rules from pattern rules
-- 'auto_import' = applied automatically during bulk import (e.g. match on transaction_type)
-- 'pattern'     = description-based pattern matching, applied manually from transactions page
ALTER TABLE merchant_rules
  ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'pattern',
  ADD COLUMN match_transaction_type TEXT;

-- Seed a default auto-import rule: all "Transfer" transactions → Exclude category
-- This runs per-household, so we insert one rule for each existing household
INSERT INTO merchant_rules (household_id, pattern, category_id, rule_type, match_transaction_type, priority, is_learned, notes)
SELECT
  h.id,
  '.*',
  c.id,
  'auto_import',
  'transfer',
  100,
  false,
  'Default rule: exclude all transfers'
FROM households h
JOIN categories c ON c.household_id = h.id AND c.name = 'exclude';
