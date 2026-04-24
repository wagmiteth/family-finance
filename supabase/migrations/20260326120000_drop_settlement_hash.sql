ALTER TABLE settlements
  DROP CONSTRAINT IF EXISTS settlements_household_hash_key;

ALTER TABLE settlements
  DROP COLUMN IF EXISTS settlement_hash;
