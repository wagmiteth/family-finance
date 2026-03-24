-- =============================================================
-- Migration: Strict Zero-Knowledge Encryption
-- =============================================================
-- Move ALL user data into client-side encrypted blobs.
-- After this migration, the server can only see:
--   - UUIDs (opaque identifiers)
--   - Timestamps (created_at, updated_at, settled_at)
--   - Boolean flags (is_settled, is_system, is_learned)
--   - Sort order integers
--   - Import hashes (SHA-256, irreversible)
--   - Email addresses (in auth.users, managed by Supabase)
--
-- DESTRUCTIVE: Drops all plaintext data columns.
-- All existing data must be deleted before running.
-- =============================================================

-- 1. Delete all existing data (user confirmed fresh start)
TRUNCATE transactions CASCADE;
TRUNCATE settlements CASCADE;
TRUNCATE merchant_rules CASCADE;
TRUNCATE upload_batches CASCADE;
TRUNCATE user_settings CASCADE;
TRUNCATE user_key_material CASCADE;
TRUNCATE categories CASCADE;
DELETE FROM users;
DELETE FROM households;

-- 2. TRANSACTIONS: replace encrypted_data BYTEA with TEXT (for base64 strings)
ALTER TABLE transactions DROP COLUMN IF EXISTS encrypted_data;
ALTER TABLE transactions ADD COLUMN encrypted_data TEXT;

ALTER TABLE transactions
  DROP COLUMN IF EXISTS amount,
  DROP COLUMN IF EXISTS date,
  DROP COLUMN IF EXISTS transaction_type,
  DROP COLUMN IF EXISTS subcategory,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS enriched_at;

-- 3. CATEGORIES: add encrypted_data, drop plaintext
ALTER TABLE categories ADD COLUMN IF NOT EXISTS encrypted_data TEXT;

-- Drop the split_ratio constraint before dropping the column
ALTER TABLE categories DROP CONSTRAINT IF EXISTS chk_split_ratio;

ALTER TABLE categories
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS display_name,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS split_type,
  DROP COLUMN IF EXISTS split_ratio,
  DROP COLUMN IF EXISTS color;

-- 4. HOUSEHOLDS: add encrypted_data, drop name
ALTER TABLE households ADD COLUMN IF NOT EXISTS encrypted_data TEXT;

ALTER TABLE households
  DROP COLUMN IF EXISTS name;

-- 5. USERS: add encrypted_data, drop name and avatar_url
ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_data TEXT;

ALTER TABLE users
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS avatar_url;

-- 6. MERCHANT_RULES: add encrypted_data, drop plaintext
ALTER TABLE merchant_rules ADD COLUMN IF NOT EXISTS encrypted_data TEXT;

ALTER TABLE merchant_rules
  DROP COLUMN IF EXISTS pattern,
  DROP COLUMN IF EXISTS merchant_name,
  DROP COLUMN IF EXISTS merchant_type,
  DROP COLUMN IF EXISTS amount_hint,
  DROP COLUMN IF EXISTS amount_max,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS match_transaction_type,
  DROP COLUMN IF EXISTS rule_type;

-- 7. SETTLEMENTS: add encrypted_data + settlement_hash, drop plaintext
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS encrypted_data TEXT;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS settlement_hash TEXT;

-- Drop the unique constraint on (household_id, month) before dropping month
ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_household_id_month_key;

ALTER TABLE settlements
  DROP COLUMN IF EXISTS month,
  DROP COLUMN IF EXISTS from_user_id,
  DROP COLUMN IF EXISTS to_user_id,
  DROP COLUMN IF EXISTS amount,
  DROP COLUMN IF EXISTS shared_total,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS settled_amount,
  DROP COLUMN IF EXISTS settled_from_user_id,
  DROP COLUMN IF EXISTS settled_to_user_id;

-- Add unique constraint on settlement_hash for dedup
ALTER TABLE settlements ADD CONSTRAINT settlements_household_hash_key
  UNIQUE (household_id, settlement_hash);

-- 8. UPLOAD_BATCHES: source is structural, keep it. file_names could reveal info, encrypt.
ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS encrypted_data TEXT;
ALTER TABLE upload_batches
  DROP COLUMN IF EXISTS file_names;
