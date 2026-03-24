-- Add notes back as a plaintext column on transactions.
-- Notes are user annotations, not sensitive bank data, so they don't need
-- to be part of the encrypted blob. This allows simple updates for both
-- V0 and V1 encrypted transactions.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT;
