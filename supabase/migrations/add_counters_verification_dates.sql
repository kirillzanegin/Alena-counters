-- Optional verification dates per counter
ALTER TABLE counters
  ADD COLUMN IF NOT EXISTS verification_date DATE,
  ADD COLUMN IF NOT EXISTS valid_until DATE;

COMMENT ON COLUMN counters.verification_date IS 'Дата последней поверки счётчика';
COMMENT ON COLUMN counters.valid_until IS 'Дата, до которой действует поверка (срок годности показаний)';

