-- ================================================================
-- РЕШЕНИЕ: Дать права authenticated роли + RLS
-- Возможно, проблема в том, что роль authenticated не имеет прав на таблицу
-- ================================================================

-- Шаг 1: Отключить RLS (если включен)
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;

-- Шаг 2: Дать права authenticated роли
GRANT SELECT, INSERT, UPDATE, DELETE ON employees TO authenticated;
GRANT USAGE ON SEQUENCE employees_id_seq TO authenticated;

-- Шаг 3: Удалить все старые политики
DROP POLICY IF EXISTS "allow_all_authenticated" ON employees;
DROP POLICY IF EXISTS "employees_self_read" ON employees;
DROP POLICY IF EXISTS "rls_employees_select_own" ON employees;
DROP POLICY IF EXISTS "rls_employees_select_owner" ON employees;
DROP POLICY IF EXISTS "rls_employees_update_own" ON employees;
DROP POLICY IF EXISTS "policy_employees_select_own" ON employees;
DROP POLICY IF EXISTS "policy_employees_select_owner" ON employees;
DROP POLICY IF EXISTS "policy_employees_update_own" ON employees;

-- Шаг 4: Включить RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Шаг 5: Создать ОДНУ супер-простую политику для теста
CREATE POLICY "test_policy_allow_all"
ON employees
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ================================================================
-- ПРОВЕРКА
-- ================================================================

-- Проверка 1: Права выданы?
SELECT 
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'employees'
  AND grantee = 'authenticated';

-- Должно показать:
-- authenticated | SELECT
-- authenticated | INSERT
-- authenticated | UPDATE
-- authenticated | DELETE

-- Проверка 2: RLS включен?
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'employees';

-- Должно показать: rowsecurity = true

-- Проверка 3: Политика создана?
SELECT 
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'employees';

-- Должно показать: test_policy_allow_all | ALL | {authenticated}

-- ================================================================
-- ТЕСТИРОВАНИЕ
-- ================================================================

/*
После выполнения:
1. Откройте приложение
2. Попробуйте войти
3. Если РАБОТАЕТ - отлично! Переходите к финальным политикам
4. Если НЕ РАБОТАЕТ - проблема глубже (Supabase Auth или конфигурация)

Если не работает:
- Откройте консоль браузера (F12)
- Посмотрите, какая ошибка в Network tab
- Отправьте мне скриншот ошибки
*/
