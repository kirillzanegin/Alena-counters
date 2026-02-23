-- ================================================================
-- ТЕСТ: Максимально простая RLS политика (100% должна работать)
-- ================================================================

-- Шаг 1: Отключить RLS (если включен)
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;

-- Шаг 2: Удалить ВСЕ старые политики
DROP POLICY IF EXISTS "policy_employees_select_own" ON employees;
DROP POLICY IF EXISTS "policy_employees_select_owner" ON employees;
DROP POLICY IF EXISTS "policy_employees_update_own" ON employees;
DROP POLICY IF EXISTS "temp_select_all" ON employees;
DROP POLICY IF EXISTS "temp_update_own" ON employees;
DROP POLICY IF EXISTS "Users can view own record" ON employees;
DROP POLICY IF EXISTS "Users can update own link_token" ON employees;
DROP POLICY IF EXISTS "Owners can view all active employees" ON employees;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON employees;
DROP POLICY IF EXISTS "Enable update for users based on auth_user_id" ON employees;
DROP POLICY IF EXISTS "Enable read access for own record" ON employees;
DROP POLICY IF EXISTS "Owners can read all active employees" ON employees;
DROP POLICY IF EXISTS "Users can update own telegram link token" ON employees;

-- Шаг 3: Включить RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Шаг 4: Создать ОДНУ супер-простую политику
-- Разрешает ВСЕМ аутентифицированным пользователям ВСЁ
CREATE POLICY "allow_all_authenticated"
ON employees
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ================================================================
-- ПРОВЕРКА
-- ================================================================

-- Проверить, что RLS включен
SELECT 
  tablename,
  rowsecurity as "RLS включен?"
FROM pg_tables
WHERE tablename = 'employees';

-- Проверить политику
SELECT 
  policyname,
  cmd as "Команда",
  roles as "Роли"
FROM pg_policies
WHERE tablename = 'employees';

-- ================================================================
-- ТЕСТИРОВАНИЕ
-- ================================================================

/*
Эта политика МАКСИМАЛЬНО простая:
- ✅ Разрешает SELECT (читать)
- ✅ Разрешает INSERT (создавать)
- ✅ Разрешает UPDATE (обновлять)
- ✅ Разрешает DELETE (удалять)
- ✅ Для ВСЕХ аутентифицированных пользователей
- ✅ БЕЗ ПРОВЕРОК (USING true)

Если НЕ работает с этой политикой - значит проблема не в политиках!

После теста:
1. Если РАБОТАЕТ → постепенно добавим ограничения
2. Если НЕ РАБОТАЕТ → проблема в Supabase Auth или конфигурации
*/
