-- Optional comment field for counters (per device)
ALTER TABLE counters
  ADD COLUMN IF NOT EXISTS counter_comment TEXT;

COMMENT ON COLUMN counters.counter_comment IS 'Optional free-form comment for the counter (location, notes, etc.)';

