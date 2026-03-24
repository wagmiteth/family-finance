-- Track the settled snapshot so we can detect adjustments after settling
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS settled_amount NUMERIC;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS settled_from_user_id UUID REFERENCES users(id);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS settled_to_user_id UUID REFERENCES users(id);
