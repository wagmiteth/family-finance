-- =============================================================
-- Migration 005: Encrypt sensitive transaction fields
-- =============================================================
-- Sensitive text fields are moved into a single encrypted BYTEA
-- column (encrypted_data). Non-sensitive fields used for queries
-- (date, amount, category_id, user_id, etc.) remain in plaintext.
--
-- Encrypted fields: description, bank_name, account_number,
-- account_name, notes, enriched_name, enriched_info,
-- enriched_description, enriched_address
-- =============================================================

-- ---------------------------------------------------------
-- 1. Generic encrypt/decrypt functions for JSON data
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION encrypt_sensitive(plaintext TEXT)
RETURNS BYTEA AS $$
DECLARE
  enc_key BYTEA;
BEGIN
  IF plaintext IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT key INTO enc_key FROM _encryption_keys WHERE id = 'default';
  IF enc_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;
  RETURN pgp_sym_encrypt(plaintext, encode(enc_key, 'hex'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrypt_sensitive(ciphertext BYTEA)
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

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION encrypt_sensitive(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION encrypt_sensitive(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION decrypt_sensitive(BYTEA) FROM anon, public;
GRANT EXECUTE ON FUNCTION decrypt_sensitive(BYTEA) TO authenticated;

-- ---------------------------------------------------------
-- 2. Add encrypted_data column to transactions
-- ---------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS encrypted_data BYTEA;

-- ---------------------------------------------------------
-- 3. Migrate existing plaintext data into encrypted blobs
-- ---------------------------------------------------------
UPDATE transactions
SET encrypted_data = encrypt_sensitive(
  jsonb_build_object(
    'description', COALESCE(description, ''),
    'bank_name', bank_name,
    'account_number', account_number,
    'account_name', account_name,
    'notes', notes,
    'enriched_name', enriched_name,
    'enriched_info', enriched_info,
    'enriched_description', enriched_description,
    'enriched_address', enriched_address
  )::text
)
WHERE encrypted_data IS NULL;

-- ---------------------------------------------------------
-- 4. Drop the plaintext columns
-- ---------------------------------------------------------
ALTER TABLE transactions
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS bank_name,
  DROP COLUMN IF EXISTS account_number,
  DROP COLUMN IF EXISTS account_name,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS enriched_name,
  DROP COLUMN IF EXISTS enriched_info,
  DROP COLUMN IF EXISTS enriched_description,
  DROP COLUMN IF EXISTS enriched_address;

-- ---------------------------------------------------------
-- 5. RPC function to read transactions with decrypted data
-- ---------------------------------------------------------
-- This runs as SECURITY DEFINER to access the encryption key,
-- but enforces household access by requiring the caller's
-- household_id (validated in the API layer via RLS on users).
CREATE OR REPLACE FUNCTION get_decrypted_transactions(
  p_household_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_category_id UUID DEFAULT NULL
)
RETURNS JSONB[] AS $$
DECLARE
  result JSONB[];
BEGIN
  SELECT array_agg(row_data ORDER BY (row_data->>'date') DESC)
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'id', t.id,
      'household_id', t.household_id,
      'user_id', t.user_id,
      'category_id', t.category_id,
      'date', t.date,
      'amount', t.amount,
      'transaction_type', t.transaction_type,
      'subcategory', t.subcategory,
      'tags', to_jsonb(COALESCE(t.tags, ARRAY[]::TEXT[])),
      'import_hash', t.import_hash,
      'enriched_at', t.enriched_at,
      'created_at', t.created_at,
      'updated_at', t.updated_at
    ) || COALESCE(decrypt_sensitive(t.encrypted_data)::jsonb, '{}'::jsonb) AS row_data
    FROM transactions t
    WHERE t.household_id = p_household_id
      AND (p_start_date IS NULL OR t.date >= p_start_date)
      AND (p_end_date IS NULL OR t.date <= p_end_date)
      AND (p_user_id IS NULL OR t.user_id = p_user_id)
      AND (p_category_id IS NULL OR t.category_id = p_category_id)
  ) sub;

  RETURN COALESCE(result, ARRAY[]::JSONB[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Single transaction lookup
CREATE OR REPLACE FUNCTION get_decrypted_transaction(
  p_transaction_id UUID,
  p_household_id UUID
)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', t.id,
    'household_id', t.household_id,
    'user_id', t.user_id,
    'category_id', t.category_id,
    'date', t.date,
    'amount', t.amount,
    'transaction_type', t.transaction_type,
    'subcategory', t.subcategory,
    'tags', to_jsonb(COALESCE(t.tags, ARRAY[]::TEXT[])),
    'import_hash', t.import_hash,
    'enriched_at', t.enriched_at,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  ) || COALESCE(decrypt_sensitive(t.encrypted_data)::jsonb, '{}'::jsonb)
  INTO result
  FROM transactions t
  WHERE t.id = p_transaction_id
    AND t.household_id = p_household_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ---------------------------------------------------------
-- 6. RPC function to insert an encrypted transaction
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION insert_encrypted_transaction(
  p_household_id UUID,
  p_user_id UUID,
  p_category_id UUID,
  p_date DATE,
  p_amount NUMERIC,
  p_transaction_type TEXT,
  p_subcategory TEXT,
  p_tags TEXT[],
  p_import_hash TEXT,
  p_sensitive_json TEXT,
  p_enriched_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  inserted_id UUID;
  result JSONB;
BEGIN
  INSERT INTO transactions (
    household_id, user_id, category_id, date, amount,
    transaction_type, subcategory, tags, import_hash,
    encrypted_data, enriched_at
  ) VALUES (
    p_household_id, p_user_id, p_category_id, p_date, p_amount,
    p_transaction_type, p_subcategory, p_tags, p_import_hash,
    encrypt_sensitive(p_sensitive_json), p_enriched_at
  )
  RETURNING id INTO inserted_id;

  -- Return the full decrypted transaction
  SELECT get_decrypted_transaction(inserted_id, p_household_id) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------
-- 7. RPC function to bulk upsert encrypted transactions
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_encrypted_transactions(
  p_transactions JSONB
)
RETURNS JSONB[] AS $$
DECLARE
  tx JSONB;
  inserted_ids UUID[] := ARRAY[]::UUID[];
  new_id UUID;
  result JSONB[];
  p_household_id UUID;
BEGIN
  FOR tx IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    INSERT INTO transactions (
      household_id, user_id, category_id, date, amount,
      transaction_type, subcategory, tags, import_hash,
      encrypted_data
    ) VALUES (
      (tx->>'household_id')::UUID,
      (tx->>'user_id')::UUID,
      NULLIF(tx->>'category_id', '')::UUID,
      (tx->>'date')::DATE,
      (tx->>'amount')::NUMERIC,
      NULLIF(tx->>'transaction_type', ''),
      NULLIF(tx->>'subcategory', ''),
      CASE WHEN tx->'tags' IS NOT NULL AND tx->'tags' != 'null'::jsonb
        THEN ARRAY(SELECT jsonb_array_elements_text(tx->'tags'))
        ELSE NULL
      END,
      tx->>'import_hash',
      encrypt_sensitive(tx->>'sensitive_json')
    )
    ON CONFLICT (household_id, import_hash) DO NOTHING
    RETURNING id INTO new_id;

    IF new_id IS NOT NULL THEN
      inserted_ids := inserted_ids || new_id;
      p_household_id := (tx->>'household_id')::UUID;
    END IF;
  END LOOP;

  -- Return decrypted inserted transactions
  IF array_length(inserted_ids, 1) > 0 THEN
    SELECT array_agg(
      jsonb_build_object(
        'id', t.id,
        'household_id', t.household_id,
        'user_id', t.user_id,
        'category_id', t.category_id,
        'date', t.date,
        'amount', t.amount,
        'transaction_type', t.transaction_type,
        'subcategory', t.subcategory,
        'tags', to_jsonb(COALESCE(t.tags, ARRAY[]::TEXT[])),
        'import_hash', t.import_hash,
        'enriched_at', t.enriched_at,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      ) || COALESCE(decrypt_sensitive(t.encrypted_data)::jsonb, '{}'::jsonb)
    )
    INTO result
    FROM transactions t
    WHERE t.id = ANY(inserted_ids);
  END IF;

  RETURN COALESCE(result, ARRAY[]::JSONB[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------
-- 8. RPC function to update encrypted transaction fields
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION update_encrypted_transaction(
  p_id UUID,
  p_household_id UUID,
  p_updates JSONB,
  p_sensitive_json TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  -- Update non-sensitive fields dynamically
  UPDATE transactions SET
    user_id = COALESCE(NULLIF(p_updates->>'user_id', ''), user_id::text)::UUID,
    category_id = CASE
      WHEN p_updates ? 'category_id' THEN NULLIF(p_updates->>'category_id', '')::UUID
      ELSE category_id
    END,
    date = COALESCE(NULLIF(p_updates->>'date', ''), date::text)::DATE,
    amount = COALESCE(NULLIF(p_updates->>'amount', ''), amount::text)::NUMERIC,
    transaction_type = CASE
      WHEN p_updates ? 'transaction_type' THEN NULLIF(p_updates->>'transaction_type', '')
      ELSE transaction_type
    END,
    subcategory = CASE
      WHEN p_updates ? 'subcategory' THEN NULLIF(p_updates->>'subcategory', '')
      ELSE subcategory
    END,
    tags = CASE
      WHEN p_updates ? 'tags' AND p_updates->'tags' != 'null'::jsonb
        THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'tags'))
      WHEN p_updates ? 'tags' THEN NULL
      ELSE tags
    END,
    enriched_at = CASE
      WHEN p_updates ? 'enriched_at' AND p_updates->>'enriched_at' IS NOT NULL
        THEN (p_updates->>'enriched_at')::TIMESTAMPTZ
      WHEN p_updates ? 'enriched_at' THEN NULL
      ELSE enriched_at
    END,
    encrypted_data = CASE
      WHEN p_sensitive_json IS NOT NULL THEN encrypt_sensitive(p_sensitive_json)
      ELSE encrypted_data
    END,
    updated_at = NOW()
  WHERE id = p_id AND household_id = p_household_id;

  -- Return the updated, decrypted transaction
  SELECT get_decrypted_transaction(p_id, p_household_id) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------
-- 9. Grant execute on new functions to authenticated users
-- ---------------------------------------------------------
GRANT EXECUTE ON FUNCTION get_decrypted_transactions(UUID, DATE, DATE, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_decrypted_transaction(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION insert_encrypted_transaction(UUID, UUID, UUID, DATE, NUMERIC, TEXT, TEXT, TEXT[], TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_encrypted_transactions(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION update_encrypted_transaction(UUID, UUID, JSONB, TEXT) TO authenticated;
