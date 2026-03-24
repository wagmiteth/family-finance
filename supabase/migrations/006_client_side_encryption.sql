-- =============================================================
-- Migration 006: Client-Side Encryption (Zero-Knowledge)
-- =============================================================
-- Moves encryption from server-side (pgcrypto) to client-side
-- (Web Crypto API). The server never sees plaintext sensitive data.
--
-- Each household has a Data Encryption Key (DEK).
-- Each user has the DEK wrapped with their password-derived KEK.
-- The invite code is used as a shared secret for key exchange.
-- =============================================================

-- ---------------------------------------------------------
-- 1. Per-user key material table
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_key_material (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kdf_salt TEXT NOT NULL,
  kdf_iterations INT NOT NULL DEFAULT 600000,
  wrapped_dek TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE user_key_material ENABLE ROW LEVEL SECURITY;

-- Users can manage their own key material
CREATE POLICY "Users can view own key material" ON user_key_material
  FOR SELECT USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can insert own key material" ON user_key_material
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own key material" ON user_key_material
  FOR UPDATE USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()))
  WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- Household members can read each other's key material (needed for key exchange)
CREATE POLICY "Household members can view household key material" ON user_key_material
  FOR SELECT USING (household_id = get_my_household_id());

-- ---------------------------------------------------------
-- 2. Invite-code-wrapped DEK on households
-- ---------------------------------------------------------
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS encrypted_dek TEXT,
  ADD COLUMN IF NOT EXISTS invite_code_salt TEXT;

-- ---------------------------------------------------------
-- 3. Encryption version tracking on transactions
-- ---------------------------------------------------------
-- 0 = server-side pgcrypto (existing)
-- 1 = client-side Web Crypto AES-GCM
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS encryption_version INT DEFAULT 0;
