-- Households
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'My Household',
  invite_code TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE NOT NULL,
  household_id UUID REFERENCES households(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categories
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  split_type TEXT NOT NULL DEFAULT 'none',
  owner_user_id UUID REFERENCES users(id),
  color TEXT,
  sort_order INT DEFAULT 0,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  category_id UUID REFERENCES categories(id),
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  date DATE NOT NULL,
  transaction_type TEXT,
  subcategory TEXT,
  tags TEXT[],
  notes TEXT,
  bank_name TEXT,
  account_number TEXT,
  account_name TEXT,
  enriched_name TEXT,
  enriched_info TEXT,
  enriched_address TEXT,
  enriched_at TIMESTAMPTZ,
  import_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, import_hash)
);

CREATE INDEX idx_tx_date ON transactions(date);
CREATE INDEX idx_tx_category ON transactions(category_id);
CREATE INDEX idx_tx_user ON transactions(user_id);
CREATE INDEX idx_tx_household ON transactions(household_id);

-- Merchant Rules
CREATE TABLE merchant_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  category_id UUID REFERENCES categories(id),
  merchant_name TEXT,
  merchant_type TEXT,
  amount_hint NUMERIC,
  amount_max NUMERIC,
  priority INT DEFAULT 0,
  is_learned BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settlements
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  from_user_id UUID REFERENCES users(id),
  to_user_id UUID REFERENCES users(id),
  amount NUMERIC NOT NULL,
  shared_total NUMERIC,
  is_settled BOOLEAN DEFAULT FALSE,
  settled_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, month)
);

-- User Settings
CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  anthropic_api_key TEXT,
  theme TEXT DEFAULT 'system',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Helper function: get household_id for current auth user
CREATE OR REPLACE FUNCTION get_my_household_id()
RETURNS UUID AS $$
  SELECT household_id FROM users WHERE auth_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Households: members can read their own household
CREATE POLICY "Users can view own household" ON households
  FOR SELECT USING (id = get_my_household_id());

CREATE POLICY "Authenticated users can create households" ON households
  FOR INSERT WITH CHECK (true);

-- Users: can see members of own household
CREATE POLICY "Users can view household members" ON users
  FOR SELECT USING (household_id = get_my_household_id());

CREATE POLICY "Users can insert own profile" ON users
  FOR INSERT WITH CHECK (auth_id = auth.uid());

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth_id = auth.uid());

-- Categories: household access
CREATE POLICY "Users can view household categories" ON categories
  FOR SELECT USING (household_id = get_my_household_id());

CREATE POLICY "Users can manage household categories" ON categories
  FOR ALL USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- Transactions: household access
CREATE POLICY "Users can view household transactions" ON transactions
  FOR SELECT USING (household_id = get_my_household_id());

CREATE POLICY "Users can manage household transactions" ON transactions
  FOR ALL USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- Merchant Rules: household access
CREATE POLICY "Users can view household rules" ON merchant_rules
  FOR SELECT USING (household_id = get_my_household_id());

CREATE POLICY "Users can manage household rules" ON merchant_rules
  FOR ALL USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- Settlements: household access
CREATE POLICY "Users can view household settlements" ON settlements
  FOR SELECT USING (household_id = get_my_household_id());

CREATE POLICY "Users can manage household settlements" ON settlements
  FOR ALL USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- User Settings: own settings only
CREATE POLICY "Users can view own settings" ON user_settings
  FOR SELECT USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can manage own settings" ON user_settings
  FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()))
  WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
