-- ================================================================
-- ВРЕМЕННОЕ РЕШЕНИЕ: RLS с максимально простыми политиками
-- Для диагностики проблемы с auth_user_id
-- ================================================================

-- ШАГ 1: Удалить все политики
DROP POLICY IF EXISTS "policy_employees_select_own" ON employees;
DROP POLICY IF EXISTS "policy_employees_select_owner" ON employees;
DROP POLICY IF EXISTS "policy_employees_update_own" ON employees;
DROP POLICY IF EXISTS "Users can view own record" ON employees;
DROP POLICY IF EXISTS "Users can update own link_token" ON employees;
DROP POLICY IF EXISTS "Owners can view all active employees" ON employees;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON employees;
DROP POLICY IF EXISTS "Enable update for users based on auth_user_id" ON employees;
DROP POLICY IF EXISTS "Enable read access for own record" ON employees;
DROP POLICY IF EXISTS "Owners can read all active employees" ON employees;
DROP POLICY IF EXISTS "Users can update own telegram link token" ON employees;

-- ШАГ 2: Включить RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- ШАГ 3: Создать МАКСИМАЛЬНО ПРОСТУЮ политику для SELECT
-- (ВРЕМЕННО: Разрешает всем аутентифицированным читать все записи)
CREATE POLICY "temp_select_all"
ON employees
FOR SELECT
TO authenticated
USING (is_active = true);

-- ШАГ 4: Политика для UPDATE (только свои данные)
CREATE POLICY "temp_update_own"
ON employees
FOR UPDATE
TO authenticated
USING (auth_user_id = auth.uid())
WITH CHECK (auth_user_id = auth.uid());

-- ================================================================
-- ПРОВЕРКА
-- ================================================================

SELECT 
  policyname,
  cmd
FROM pg_policies
WHERE tablename = 'employees';

-- Должно показать 2 политики:
-- 1. temp_select_all (SELECT)
-- 2. temp_update_own (UPDATE)

-- ================================================================
-- ВАЖНО: Это ВРЕМЕННОЕ решение!
-- ================================================================

/*
⚠️ ВНИМАНИЕ:
Политика "temp_select_all" разрешает ВСЕМ аутентифицированным
пользователям читать ВСЕ записи employees.

Это означает:
- ✅ Вход работает гарантированно
- ✅ Привязка Telegram работает
- ⚠️ Обычные пользователи могут видеть других пользователей

Это НЕ идеально для безопасности, но:
1. Лучше, чем полностью отключенный RLS
2. Позволит войти и работать
3. Позволит диагностировать проблему с auth_user_id

После того, как найдём проблему с auth_user_id,
мы вернём правильные политики.
*/

-- ================================================================
-- Следующий шаг: Проверить auth_user_id
-- ================================================================

-- Выполните этот запрос и отправьте мне результат:
SELECT 
  e.id,
  e.email,
  e.auth_user_id as employee_auth_user_id,
  u.id as auth_users_id,
  CASE 
    WHEN e.auth_user_id = u.id THEN '✅ Совпадает'
    WHEN e.auth_user_id IS NULL THEN '❌ NULL в employees'
    ELSE '❌ НЕ совпадает!'
  END as status
FROM employees e
LEFT JOIN auth.users u ON e.email = u.email
ORDER BY e.created_at DESC;

-- Если видите "❌ НЕ совпадает" или "❌ NULL" - это проблема!
