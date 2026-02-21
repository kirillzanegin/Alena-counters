-- Owners table: optional "sign of object ownership" for objects
CREATE TABLE owners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read owners"
  ON owners FOR SELECT USING (true);

CREATE POLICY "authenticated can insert owners"
  ON owners FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated can update owners"
  ON owners FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Add optional owner reference to objects
ALTER TABLE objects
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES owners(id) ON DELETE SET NULL;

-- Optional: add index for filtering by owner
CREATE INDEX IF NOT EXISTS idx_objects_owner_id ON objects(owner_id);
