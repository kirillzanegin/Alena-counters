-- Optional operator reference for each counter (service company)
ALTER TABLE counters
  ADD COLUMN IF NOT EXISTS operator_id UUID REFERENCES operators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_counters_operator_id ON counters(operator_id);

