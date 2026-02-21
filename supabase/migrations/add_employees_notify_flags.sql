-- Contact channels for future announcements: optional checkboxes per channel.
-- If set, user can receive announcements via this channel (show indicator in UI).
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS notify_via_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_via_telegram BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_via_max BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN employees.notify_via_email IS 'Receive announcements via email when set';
COMMENT ON COLUMN employees.notify_via_telegram IS 'Receive announcements via Telegram when set';
COMMENT ON COLUMN employees.notify_via_max IS 'Receive announcements via Max ID when set';
