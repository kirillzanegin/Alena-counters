-- Обновление таблицы telegram_link_tokens для поддержки двух способов привязки
-- 
-- СПОСОБ 1 (старый): Из приложения → Генерация токена → Переход в бота
--   Записи: employee_id != NULL, tg_id = NULL
--
-- СПОСОБ 2 (новый): Из Telegram → Генерация кода → Ввод в приложении
--   Записи: employee_id = NULL, tg_id != NULL

-- Добавить колонку tg_id (если её ещё нет)
ALTER TABLE telegram_link_tokens 
ADD COLUMN IF NOT EXISTS tg_id TEXT;

-- Создать индекс для быстрого поиска по tg_id
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_tg_id ON telegram_link_tokens(tg_id);

-- Сделать employee_id nullable (для нового способа)
ALTER TABLE telegram_link_tokens 
ALTER COLUMN employee_id DROP NOT NULL;

-- Обновить RLS политики для поддержки обоих способов привязки

-- Удаляем старые политики
DROP POLICY IF EXISTS "Users can create their own tokens" ON telegram_link_tokens;
DROP POLICY IF EXISTS "Users can read their own tokens" ON telegram_link_tokens;
DROP POLICY IF EXISTS "Users can update tokens for linking" ON telegram_link_tokens;
DROP POLICY IF EXISTS "Service role can update tokens" ON telegram_link_tokens;

-- Политика для вставки (оба способа)
CREATE POLICY "Users can create tokens" ON telegram_link_tokens
  FOR INSERT
  WITH CHECK (
    -- Способ 1: пользователь создаёт токен для себя
    (auth.uid() IN (SELECT auth_user_id FROM employees WHERE id = employee_id) AND tg_id IS NULL)
    OR 
    -- Способ 2: бот создаёт код (через service_role)
    (employee_id IS NULL AND tg_id IS NOT NULL)
  );

-- Политика для чтения (оба способа)
CREATE POLICY "Users can read tokens" ON telegram_link_tokens
  FOR SELECT
  USING (
    -- Способ 1: пользователь читает свои токены
    (auth.uid() IN (SELECT auth_user_id FROM employees WHERE id = employee_id))
    OR 
    -- Способ 2: пользователь ищет код по tg_id
    (employee_id IS NULL)
  );

-- Политика для обновления (при привязке через код)
CREATE POLICY "Users can update tokens" ON telegram_link_tokens
  FOR UPDATE
  USING (
    auth.uid() IN (SELECT auth_user_id FROM employees WHERE id = employee_id)
    OR employee_id IS NULL
  );

-- Service role может делать всё (для бота)
CREATE POLICY "Service role full access" ON telegram_link_tokens
  FOR ALL
  USING (true);

-- Комментарии для документации
COMMENT ON COLUMN telegram_link_tokens.employee_id IS 'ID сотрудника для способа 1 (из приложения). NULL для способа 2 (из Telegram).';
COMMENT ON COLUMN telegram_link_tokens.tg_id IS 'Telegram ID для способа 2 (из Telegram). NULL для способа 1 (из приложения).';
COMMENT ON COLUMN telegram_link_tokens.token IS 'Токен привязки. Длинный буквенно-цифровой для способа 1, 6 цифр для способа 2.';
COMMENT ON TABLE telegram_link_tokens IS 'Токены для привязки Telegram. Поддерживает два способа: из приложения (employee_id) и из Telegram (tg_id).';

