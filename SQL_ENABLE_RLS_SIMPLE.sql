-- ================================================================
-- ВКЛЮЧЕНИЕ RLS С ПРАВИЛЬНЫМИ ПОЛИТИКАМИ
-- Эти политики НЕ блокируют вход в систему!
-- ================================================================

-- ШАГ 1: Удалить ВСЕ старые политики
-- ================================================================
DROP POLICY IF EXISTS "Users can view own record" ON employees;
DROP POLICY IF EXISTS "Users can update own link_token" ON employees;
DROP POLICY IF EXISTS "Owners can view all active employees" ON employees;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON employees;
DROP POLICY IF EXISTS "Enable update for users based on auth_user_id" ON employees;
DROP POLICY IF EXISTS "Enable read access for own record" ON employees;
DROP POLICY IF EXISTS "Owners can read all active employees" ON employees;
DROP POLICY IF EXISTS "Users can update own telegram link token" ON employees;

-- ШАГ 2: Включить RLS
-- ================================================================
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- ШАГ 3: Создать ТОЛЬКО 3 простые политики
-- ================================================================

-- Политика 1: Каждый пользователь может читать свою запись
CREATE POLICY "policy_employees_select_own"
ON employees
FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

-- Политика 2: Владельцы могут читать ВСЕ записи активных сотрудников
CREATE POLICY "policy_employees_select_owner"
ON employees
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE auth_user_id = auth.uid()
      AND role = 'owner'
      AND is_active = true
  )
);

-- Политика 3: Каждый пользователь может обновлять СВОИ данные
CREATE POLICY "policy_employees_update_own"
ON employees
FOR UPDATE
TO authenticated
USING (auth_user_id = auth.uid())
WITH CHECK (auth_user_id = auth.uid());

-- ================================================================
-- ПРОВЕРКА: Убедиться, что всё создано правильно
-- ================================================================

-- Проверка 1: RLS включен
SELECT 
  schemaname,
  tablename,
  rowsecurity as "RLS_enabled"
FROM pg_tables
WHERE tablename = 'employees';
-- Должно показать: RLS_enabled = true (или t)

-- Проверка 2: Созданы все 3 политики
SELECT 
  policyname as "Policy Name",
  cmd as "Command",
  roles as "Roles"
FROM pg_policies
WHERE tablename = 'employees'
ORDER BY policyname;
-- Должно показать 3 политики:
-- 1. policy_employees_select_own (SELECT)
-- 2. policy_employees_select_owner (SELECT)
-- 3. policy_employees_update_own (UPDATE)

-- ================================================================
-- ВАЖНО: Как это работает
-- ================================================================

/*
✅ Политика 1 (policy_employees_select_own):
   - Разрешает каждому пользователю ЧИТАТЬ свою запись
   - Условие: auth_user_id = auth.uid()
   - Это позволяет входить в систему!

✅ Политика 2 (policy_employees_select_owner):
   - Разрешает владельцам ЧИТАТЬ все записи сотрудников
   - Условие: текущий пользователь имеет role = 'owner'
   - Это позволяет управлять пользователями!

✅ Политика 3 (policy_employees_update_own):
   - Разрешает каждому пользователю ОБНОВЛЯТЬ свою запись
   - Условие: auth_user_id = auth.uid()
   - Это позволяет привязывать Telegram!

🔒 Что заблокировано:
   ❌ Пользователи НЕ могут читать чужие записи (кроме владельцев)
   ❌ Пользователи НЕ могут обновлять чужие записи
   ❌ Неаутентифицированные пользователи НЕ имеют доступа

⚡ Edge Functions (service_role):
   ✅ Обходят все RLS политики автоматически
   ✅ Могут создавать и обновлять любые записи
   ✅ Это нужно для admin-create-user и admin-update-user
*/

-- ================================================================
-- Готово! Теперь:
-- 1. RLS включен
-- 2. Пользователи могут входить
-- 3. Владельцы видят всех сотрудников
-- 4. Привязка Telegram работает
-- 5. Данные защищены
-- ================================================================
