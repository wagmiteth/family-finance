-- Upload batches: track each bulk import session
CREATE TABLE upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  uploaded_by UUID REFERENCES users(id),
  file_names TEXT[] NOT NULL DEFAULT '{}',
  transaction_count INT NOT NULL DEFAULT 0,
  duplicate_count INT NOT NULL DEFAULT 0,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_upload_batches_household ON upload_batches(household_id);

-- Add batch_id to transactions
ALTER TABLE transactions ADD COLUMN batch_id UUID REFERENCES upload_batches(id) ON DELETE SET NULL;
CREATE INDEX idx_tx_batch ON transactions(batch_id);

-- RLS
ALTER TABLE upload_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view household upload batches" ON upload_batches
  FOR SELECT USING (household_id = get_my_household_id());

CREATE POLICY "Users can manage household upload batches" ON upload_batches
  FOR ALL USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());
