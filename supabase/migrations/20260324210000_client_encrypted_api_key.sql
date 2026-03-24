-- =============================================================
-- Migration: Client-side encrypted API key
-- =============================================================
-- Move API key from server-side pgcrypto to client-side encryption.
-- The encrypted_api_key column becomes a client-encrypted blob
-- (same as all other encrypted_data columns).
-- Drop the server-side encrypt/decrypt functions.
-- =============================================================

-- Drop old pgcrypto-encrypted column and add new TEXT column
ALTER TABLE user_settings DROP COLUMN IF EXISTS encrypted_api_key;
ALTER TABLE user_settings ADD COLUMN encrypted_api_key TEXT;

-- Drop server-side API key encrypt/decrypt functions
DROP FUNCTION IF EXISTS encrypt_api_key(TEXT);
DROP FUNCTION IF EXISTS decrypt_api_key(BYTEA);

-- The _encryption_keys table is no longer needed
-- (was only used by encrypt/decrypt_api_key and the dropped V0 functions)
DROP TABLE IF EXISTS _encryption_keys;
