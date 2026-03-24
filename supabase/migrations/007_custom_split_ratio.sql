-- =============================================================
-- Migration 007: Custom Split Ratio per Category
-- =============================================================
-- Adds split_ratio to categories for flexible expense splitting.
-- Default 50 = equal 50/50 split. Value represents user1's %.
-- Only meaningful when split_type = 'equal'.
-- =============================================================

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS split_ratio INT NOT NULL DEFAULT 50;

ALTER TABLE categories
  ADD CONSTRAINT chk_split_ratio CHECK (split_ratio BETWEEN 1 AND 99);
