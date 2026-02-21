-- Create counter_types table for dynamic meter type management
CREATE TABLE counter_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with the current 16 types (preserving current order)
INSERT INTO counter_types (name, sort_order) VALUES
  ('ХВС 1',   1), ('ГВС 1',   2),
  ('ХВС 2',   3), ('ГВС 2',   4),
  ('ХВС 3',   5), ('ГВС 3',   6),
  ('Т1 день', 7), ('Т1 ночь', 8),
  ('Т2 день', 9), ('Т2 ночь', 10),
  ('Т3 день', 11),('Т3 ночь', 12),
  ('Т внутр', 13),('Т общий', 14),
  ('Т дублер',15),('Отопление',16);

-- Enable Row Level Security
ALTER TABLE counter_types ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read counter types
CREATE POLICY "anyone can read counter_types"
  ON counter_types FOR SELECT USING (true);

-- Optional: Allow only authenticated users to insert/update (for future admin panel)
CREATE POLICY "authenticated can insert counter_types"
  ON counter_types FOR INSERT 
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated can update counter_types"
  ON counter_types FOR UPDATE 
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
