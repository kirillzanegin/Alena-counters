-- Проверка и исправление RLS политик для работы с токенами Telegram

-- Шаг 1: Проверить, есть ли колонки link_token и link_expires_at
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'employees'
  AND column_name IN ('link_token', 'link_expires_at', 'tg_id');

-- Если колонок нет, добавьте их (должны быть из SQL_TELEGRAM_SIMPLIFY.sql):
-- ALTER TABLE employees
-- ADD COLUMN IF NOT EXISTS link_token TEXT,
-- ADD COLUMN IF NOT EXISTS link_expires_at TIMESTAMP WITH TIME ZONE;

-- Шаг 2: Проверить текущие RLS политики
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'employees';

-- Шаг 3: Убедиться, что пользователь может обновлять свой link_token
-- Если политики блокируют UPDATE, создайте эту политику:

CREATE POLICY IF NOT EXISTS "Users can update own link_token"
ON employees
FOR UPDATE
TO authenticated
USING (auth.uid() = auth_user_id)
WITH CHECK (auth.uid() = auth_user_id);

-- Шаг 4: Убедиться, что service_role может читать/обновлять tg_id
-- (для Edge Function, которая использует SUPABASE_SERVICE_ROLE_KEY)
-- Service role обычно обходит RLS, но проверим:

-- Если нужно, можно временно отключить RLS для отладки (ТОЛЬКО ДЛЯ ТЕСТА!):
-- ALTER TABLE employees DISABLE ROW LEVEL SECURITY;

-- После успешного теста включите обратно:
-- ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Шаг 5: Проверить, что колонки доступны для чтения/записи
SELECT 
  id,
  email,
  first_name,
  last_name,
  link_token,
  link_expires_at,
  tg_id,
  is_active
FROM employees
WHERE is_active = true
LIMIT 5;
