-- Optional personal account (ЛК) access fields per counter
ALTER TABLE counters
  ADD COLUMN IF NOT EXISTS lk_url TEXT,
  ADD COLUMN IF NOT EXISTS lk_login TEXT,
  ADD COLUMN IF NOT EXISTS lk_password TEXT;

COMMENT ON COLUMN counters.lk_url IS 'URL для входа в личный кабинет по данному счётчику';
COMMENT ON COLUMN counters.lk_login IS 'Логин для личного кабинета по данному счётчику';
COMMENT ON COLUMN counters.lk_password IS 'Пароль для личного кабинета по данному счётчику';

