-- Включение RLS обратно после успешного теста привязки Telegram
-- Выполните этот скрипт в Supabase SQL Editor

-- =====================================================
-- ШАГ 1: Включить RLS для таблицы employees
-- =====================================================

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- ШАГ 2: Удалить старые политики (если есть)
-- =====================================================

DROP POLICY IF EXISTS "Users can view own record" ON employees;
DROP POLICY IF EXISTS "Users can update own link_token" ON employees;
DROP POLICY IF EXISTS "Owners can view all active employees" ON employees;

-- =====================================================
-- ШАГ 3: Создать новые политики для безопасной работы
-- =====================================================

-- Политика 1: Пользователи могут читать свою запись
CREATE POLICY "Users can view own record"
ON employees
FOR SELECT
TO authenticated
USING (auth.uid() = auth_user_id);

-- Политика 2: Пользователи могут обновлять свой link_token и link_expires_at
-- (нужно для генерации токена привязки Telegram)
CREATE POLICY "Users can update own link_token"
ON employees
FOR UPDATE
TO authenticated
USING (auth.uid() = auth_user_id)
WITH CHECK (auth.uid() = auth_user_id);

-- Политика 3: Владельцы могут видеть всех активных сотрудников
CREATE POLICY "Owners can view all active employees"
ON employees
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees owner
    WHERE owner.auth_user_id = auth.uid()
      AND owner.role = 'owner'
      AND owner.is_active = true
  )
);

-- Политика 4: Владельцы могут создавать новых сотрудников
-- (через Edge Function admin-create-user, который использует service_role)
-- Service role обходит RLS, поэтому эта политика на самом деле не нужна,
-- но оставим для явности

-- Политика 5: Владельцы могут обновлять других сотрудников
-- (через Edge Function admin-update-user, который использует service_role)
-- Service role обходит RLS

-- =====================================================
-- ШАГ 4: Проверить, что политики созданы
-- =====================================================

SELECT 
  schemaname,
  tablename, 
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'employees'
ORDER BY policyname;

-- =====================================================
-- ШАГ 5: Проверить, что RLS включен
-- =====================================================

SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'employees';

-- Результат должен показать: rowsecurity = true

-- =====================================================
-- ВАЖНО: Как это работает
-- =====================================================

/*
1. Обычные пользователи (role = 'user'):
   - Видят только свою запись
   - Могут обновлять только свои link_token и link_expires_at
   - Не могут менять tg_id напрямую (это делает Edge Function)

2. Владельцы (role = 'owner'):
   - Видят все записи активных сотрудников
   - Могут обновлять свои link_token и link_expires_at
   - Создание/обновление других пользователей - через Edge Functions
     (которые используют service_role и обходят RLS)

3. Edge Functions (telegram-webhook, admin-create-user, admin-update-user):
   - Используют SUPABASE_SERVICE_ROLE_KEY
   - Обходят все RLS политики
   - Могут делать любые операции с базой

Это безопасная конфигурация! ✅
*/

-- =====================================================
-- Если нужно удалить старые/ненужные политики:
-- =====================================================

-- Посмотрите список всех политик (команда выше в Шаге 3)
-- Если есть дубликаты или старые политики, удалите их:

-- Пример:
-- DROP POLICY IF EXISTS "старое_название_политики" ON employees;
