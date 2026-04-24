-- =============================================================
-- Migration: Add owner_user_id to merchant_rules
-- =============================================================
-- Allows merchant rules (specifically exclude rules) to be
-- scoped to a single user. Rules with owner_user_id set are
-- only visible to that user via RLS. Rules with NULL
-- owner_user_id remain visible to all household members.
-- =============================================================

-- 0. Helper: get the current user's app user ID
CREATE OR REPLACE FUNCTION get_my_user_id()
RETURNS UUID AS $$
  SELECT id FROM users WHERE auth_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 1. Add nullable owner_user_id column
ALTER TABLE merchant_rules
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- 2. Index for efficient per-user lookups
CREATE INDEX IF NOT EXISTS idx_merchant_rules_owner
  ON merchant_rules(owner_user_id);

-- 3. Update the SELECT policy: shared rules (owner_user_id IS NULL)
--    are visible to all household members; private rules are only
--    visible to the owning user.
DROP POLICY IF EXISTS "Users can view household rules" ON merchant_rules;
CREATE POLICY "Users can view household rules" ON merchant_rules
  FOR SELECT USING (
    household_id = get_my_household_id()
    AND (
      owner_user_id IS NULL
      OR owner_user_id = get_my_user_id()
    )
  );

-- 4. Update DELETE policy: users can only delete their own private
--    rules, or shared rules.
DROP POLICY IF EXISTS "Users can delete household rules" ON merchant_rules;
CREATE POLICY "Users can delete household rules" ON merchant_rules
  FOR DELETE USING (
    household_id = get_my_household_id()
    AND (
      owner_user_id IS NULL
      OR owner_user_id = get_my_user_id()
    )
  );

-- 5. Update UPDATE policy similarly.
DROP POLICY IF EXISTS "Users can update household rules" ON merchant_rules;
CREATE POLICY "Users can update household rules" ON merchant_rules
  FOR UPDATE USING (
    household_id = get_my_household_id()
    AND (
      owner_user_id IS NULL
      OR owner_user_id = get_my_user_id()
    )
  ) WITH CHECK (
    household_id = get_my_household_id()
    AND (
      owner_user_id IS NULL
      OR owner_user_id = get_my_user_id()
    )
  );
