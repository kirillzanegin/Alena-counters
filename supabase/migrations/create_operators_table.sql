-- Operators table: service companies for counters/objects
CREATE TABLE IF NOT EXISTS operators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read operators"
  ON operators FOR SELECT USING (true);

CREATE POLICY "authenticated can insert operators"
  ON operators FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated can update operators"
  ON operators FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Initial operators
INSERT INTO operators (name, sort_order, is_active) VALUES
  ('Водоканал', 1, true),
  ('ПАО Т Плюс', 2, true),
  ('Химмашэнерго', 3, true),
  ('ЕСК', 4, true),
  ('ЕТК', 5, true)
ON CONFLICT (name) DO NOTHING;

-- Optional operator reference on objects
ALTER TABLE objects
  ADD COLUMN IF NOT EXISTS operator_id UUID REFERENCES operators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_objects_operator_id ON objects(operator_id);

