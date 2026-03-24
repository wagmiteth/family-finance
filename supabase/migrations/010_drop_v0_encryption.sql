-- =============================================================
-- Migration 009: Remove V0 server-side encryption
-- =============================================================
-- All transactions now use V1 client-side encryption.
-- Drop the V0 RPC functions that used pgcrypto for
-- server-side encrypt/decrypt of transaction data.
-- Note: _encryption_keys table and encrypt/decrypt_api_key
-- functions are kept — they're used for API key storage.
-- =============================================================

-- Drop V0 transaction RPC functions
DROP FUNCTION IF EXISTS get_decrypted_transactions(UUID, DATE, DATE, UUID, UUID);
DROP FUNCTION IF EXISTS get_decrypted_transaction(UUID, UUID);
DROP FUNCTION IF EXISTS insert_encrypted_transaction(UUID, UUID, UUID, DATE, NUMERIC, TEXT, TEXT, TEXT[], TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS upsert_encrypted_transactions(JSONB);
DROP FUNCTION IF EXISTS update_encrypted_transaction(UUID, UUID, JSONB, TEXT);

-- Drop the generic encrypt/decrypt helpers (only used by above RPCs)
DROP FUNCTION IF EXISTS encrypt_sensitive(TEXT);
DROP FUNCTION IF EXISTS decrypt_sensitive(BYTEA);

-- Remove encryption_version column — all transactions are V1 now
ALTER TABLE transactions DROP COLUMN IF EXISTS encryption_version;
