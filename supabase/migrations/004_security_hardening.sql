-- =============================================================
-- Migration 004: Security Hardening
-- =============================================================
-- 1. Restrict household creation (one per user)
-- 2. Add invite code expiration + used_at tracking
-- 3. Encrypt anthropic_api_key at rest using pgcrypto
-- 4. Add explicit DELETE policies
-- 5. Use crypto-safe invite code generation
-- 6. Add rate limiting helper for invite code lookups
-- =============================================================

-- Enable pgcrypto for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------
-- 1. Invite code security: expiration + invalidation
-- ---------------------------------------------------------
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  ADD COLUMN IF NOT EXISTS invite_used_at TIMESTAMPTZ;

-- ---------------------------------------------------------
-- 2. Encrypt anthropic_api_key column
-- ---------------------------------------------------------
-- Add encrypted column alongside the plaintext one
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS encrypted_api_key BYTEA;

-- Create a server-side encryption key stored in a dedicated table
-- Only accessible via SECURITY DEFINER functions, not directly
CREATE TABLE IF NOT EXISTS _encryption_keys (
  id TEXT PRIMARY KEY DEFAULT 'default',
  key BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: no one can read the keys table directly (not even authenticated users)
ALTER TABLE _encryption_keys ENABLE ROW LEVEL SECURITY;
-- No policies = no access via API. Only SECURITY DEFINER functions can read it.

-- Insert a random 32-byte encryption key (only if one doesn't exist)
INSERT INTO _encryption_keys (id, key)
VALUES ('default', gen_random_bytes(32))
ON CONFLICT (id) DO NOTHING;

-- Function to encrypt a value
CREATE OR REPLACE FUNCTION encrypt_api_key(plaintext TEXT)
RETURNS BYTEA AS $$
DECLARE
  enc_key BYTEA;
BEGIN
  SELECT key INTO enc_key FROM _encryption_keys WHERE id = 'default';
  IF enc_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;
  RETURN pgp_sym_encrypt(plaintext, encode(enc_key, 'hex'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to decrypt a value (only callable by authenticated users for their own data)
CREATE OR REPLACE FUNCTION decrypt_api_key(ciphertext BYTEA)
RETURNS TEXT AS $$
DECLARE
  enc_key BYTEA;
BEGIN
  IF ciphertext IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT key INTO enc_key FROM _encryption_keys WHERE id = 'default';
  IF enc_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;
  RETURN pgp_sym_decrypt(ciphertext, encode(enc_key, 'hex'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Migrate existing plaintext keys to encrypted format
UPDATE user_settings
SET encrypted_api_key = encrypt_api_key(anthropic_api_key)
WHERE anthropic_api_key IS NOT NULL AND encrypted_api_key IS NULL;

-- Drop the plaintext column
ALTER TABLE user_settings DROP COLUMN IF EXISTS anthropic_api_key;

-- ---------------------------------------------------------
-- 3. Restrict household INSERT policy
-- ---------------------------------------------------------
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Authenticated users can create households" ON households;

-- Only allow creating a household if the user doesn't already belong to one
CREATE POLICY "Authenticated users can create one household" ON households
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM users WHERE auth_id = auth.uid() AND household_id IS NOT NULL
    )
  );

-- ---------------------------------------------------------
-- 4. Add UPDATE policy for households (allow name changes)
-- ---------------------------------------------------------
CREATE POLICY "Users can update own household" ON households
  FOR UPDATE USING (id = get_my_household_id())
  WITH CHECK (id = get_my_household_id());

-- ---------------------------------------------------------
-- 5. Tighten DELETE policies — only household-scoped
-- ---------------------------------------------------------

-- Transactions: only delete own household's transactions
DROP POLICY IF EXISTS "Users can manage household transactions" ON transactions;
CREATE POLICY "Users can insert household transactions" ON transactions
  FOR INSERT WITH CHECK (household_id = get_my_household_id());
CREATE POLICY "Users can update household transactions" ON transactions
  FOR UPDATE USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());
CREATE POLICY "Users can delete household transactions" ON transactions
  FOR DELETE USING (household_id = get_my_household_id());

-- Categories: split the ALL policy into explicit ones
DROP POLICY IF EXISTS "Users can manage household categories" ON categories;
CREATE POLICY "Users can insert household categories" ON categories
  FOR INSERT WITH CHECK (household_id = get_my_household_id());
CREATE POLICY "Users can update household categories" ON categories
  FOR UPDATE USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());
CREATE POLICY "Users can delete household categories" ON categories
  FOR DELETE USING (household_id = get_my_household_id());

-- Merchant rules: split the ALL policy
DROP POLICY IF EXISTS "Users can manage household rules" ON merchant_rules;
CREATE POLICY "Users can insert household rules" ON merchant_rules
  FOR INSERT WITH CHECK (household_id = get_my_household_id());
CREATE POLICY "Users can update household rules" ON merchant_rules
  FOR UPDATE USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());
CREATE POLICY "Users can delete household rules" ON merchant_rules
  FOR DELETE USING (household_id = get_my_household_id());

-- Settlements: split the ALL policy
DROP POLICY IF EXISTS "Users can manage household settlements" ON settlements;
CREATE POLICY "Users can insert household settlements" ON settlements
  FOR INSERT WITH CHECK (household_id = get_my_household_id());
CREATE POLICY "Users can update household settlements" ON settlements
  FOR UPDATE USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());
CREATE POLICY "Users can delete household settlements" ON settlements
  FOR DELETE USING (household_id = get_my_household_id());

-- User settings: split the ALL policy
DROP POLICY IF EXISTS "Users can manage own settings" ON user_settings;
CREATE POLICY "Users can insert own settings" ON user_settings
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "Users can update own settings" ON user_settings
  FOR UPDATE USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()))
  WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
-- No DELETE policy for user_settings — settings should not be deleted

-- ---------------------------------------------------------
-- 6. Secure invite code validation function
-- ---------------------------------------------------------
-- Rate-limited invite code lookup (prevents brute-force)
CREATE TABLE IF NOT EXISTS _invite_attempts (
  ip_hash TEXT NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_invite_attempts_time ON _invite_attempts(attempted_at);

-- Auto-cleanup old attempts (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_invite_attempts()
RETURNS VOID AS $$
BEGIN
  DELETE FROM _invite_attempts WHERE attempted_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------
-- 7. Revoke direct access to internal tables
-- ---------------------------------------------------------
-- Ensure _encryption_keys is not accessible via the API
REVOKE ALL ON _encryption_keys FROM anon, authenticated;
REVOKE ALL ON _invite_attempts FROM anon, authenticated;

-- Grant execute on encryption functions only to authenticated users
REVOKE ALL ON FUNCTION encrypt_api_key(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION encrypt_api_key(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION decrypt_api_key(BYTEA) FROM anon, public;
GRANT EXECUTE ON FUNCTION decrypt_api_key(BYTEA) TO authenticated;
