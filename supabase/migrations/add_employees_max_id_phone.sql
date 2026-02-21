-- Optional fields for employees: Max ID and phone number
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS max_id TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN employees.max_id IS 'Optional external/max identifier';
COMMENT ON COLUMN employees.phone IS 'Optional phone, e.g. +7 999 123-45-67';
