-- Plaintext fields for invite preview (visible only to invite code holders)
ALTER TABLE households ADD COLUMN IF NOT EXISTS invite_display_name TEXT;
ALTER TABLE households ADD COLUMN IF NOT EXISTS invite_display_household TEXT;
ALTER TABLE households ADD COLUMN IF NOT EXISTS invite_display_avatar TEXT;
