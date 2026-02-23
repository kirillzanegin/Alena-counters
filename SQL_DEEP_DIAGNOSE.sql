-- ================================================================
-- ГЛУБОКАЯ ДИАГНОСТИКА: Почему RLS не работает?
-- ================================================================

-- Проверка 1: RLS включен для таблицы employees?
SELECT 
  schemaname,
  tablename,
  rowsecurity as "RLS_enabled"
FROM pg_tables
WHERE tablename = 'employees';

-- Ожидаемый результат: RLS_enabled = true

-- ================================================================
-- Проверка 2: Какие политики существуют?
-- ================================================================

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'employees'
ORDER BY policyname;

-- ================================================================
-- Проверка 3: Может ли authenticated роль читать employees?
-- ================================================================

-- Проверим права доступа на уровне таблицы
SELECT 
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'employees'
  AND grantee IN ('authenticated', 'anon', 'service_role');

-- ================================================================
-- Проверка 4: Есть ли проблема с схемой?
-- ================================================================

SELECT 
  table_schema,
  table_name
FROM information_schema.tables
WHERE table_name = 'employees';

-- Должно быть: table_schema = 'public'

-- ================================================================
-- Проверка 5: Тест политики вручную
-- ================================================================

-- Попробуем симулировать SELECT от имени аутентифицированного пользователя
-- Замените 'ВАШ_AUTH_USER_ID' на ваш реальный UUID

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" = '{"sub":"ВАШ_AUTH_USER_ID"}';

SELECT 
  id,
  email,
  auth_user_id,
  role
FROM employees
WHERE auth_user_id = 'ВАШ_AUTH_USER_ID';

RESET role;

-- ================================================================
-- ВОЗМОЖНЫЕ ПРОБЛЕМЫ
-- ================================================================

/*
Если RLS не работает даже с USING (true), возможные причины:

1. Роль 'authenticated' не имеет базовых прав SELECT на таблицу
   Решение: GRANT SELECT ON employees TO authenticated;

2. RLS включен, но политики не активны из-за неправильной роли
   Решение: Проверить, что политика создана TO authenticated

3. Supabase JavaScript client использует неправильную роль
   Решение: Проверить connection string

4. Проблема с realtime / postgrest
   Решение: Перезапустить Supabase проект

5. auth.uid() возвращает NULL
   Решение: Проверить, что пользователь действительно залогинен
*/
