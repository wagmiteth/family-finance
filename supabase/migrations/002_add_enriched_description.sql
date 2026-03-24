-- Add enriched_description column for storing what the company does
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS enriched_description TEXT;
