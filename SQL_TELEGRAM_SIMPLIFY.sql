-- Упрощение привязки Telegram: переход на хранение токенов в employees
-- Убираем отдельную таблицу telegram_link_tokens и коды - всё автоматически через Telegram WebApp API

-- Шаг 1: Добавить колонки в employees для токена привязки (способ 1: из приложения)
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS link_token TEXT,
ADD COLUMN IF NOT EXISTS link_expires_at TIMESTAMP WITH TIME ZONE;

-- Индекс для быстрого поиска по токену
CREATE INDEX IF NOT EXISTS idx_employees_link_token ON employees(link_token);

-- Комментарии
COMMENT ON COLUMN employees.link_token IS 'Токен для привязки Telegram (генерируется в приложении). NULL если не ожидается привязка.';
COMMENT ON COLUMN employees.link_expires_at IS 'Срок действия токена привязки. После этого времени токен недействителен.';
COMMENT ON COLUMN employees.tg_id IS 'Telegram ID пользователя. Заполняется автоматически при открытии из Telegram или вручную через токен из приложения.';

-- Шаг 2 (опционально, после проверки): Удалить старую таблицу telegram_link_tokens
-- DROP TABLE IF EXISTS telegram_link_tokens CASCADE;

-- Готово! Теперь:
-- - При открытии из Telegram WebApp приложение само получает Telegram ID и записывает в tg_id
-- - При открытии из браузера пользователь может сгенерировать токен и перейти по ссылке в бота
-- - Бот при /start TOKEN обновляет tg_id в employees
-- - Никаких кодов и отдельных таблиц
