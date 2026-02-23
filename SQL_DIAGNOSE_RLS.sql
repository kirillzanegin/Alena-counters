-- Диагностика: Почему RLS блокирует вход?
-- Выполните эти запросы по очереди

-- ================================================================
-- Проверка 1: Посмотреть данные в employees
-- ================================================================
SELECT 
  id,
  email,
  auth_user_id,
  role,
  is_active,
  tg_id
FROM employees
ORDER BY created_at DESC;

-- Что смотреть:
-- ✅ auth_user_id должен быть заполнен (не NULL)
-- ✅ is_active должен быть true
-- Скопируйте свой auth_user_id для следующего шага

-- ================================================================
-- Проверка 2: Какой auth.uid() возвращается при логине?
-- ================================================================
-- Это покажет текущий auth.uid() (если вы залогинены в Supabase Dashboard)
SELECT auth.uid() as current_auth_uid;

-- ================================================================
-- Проверка 3: Проверить политики
-- ================================================================
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'employees'
ORDER BY policyname;

-- ================================================================
-- Проверка 4: Тестировать политику SELECT вручную
-- ================================================================
-- Замените 'ВАШ_AUTH_USER_ID' на реальный UUID из Проверки 1

-- Симуляция: Может ли пользователь прочитать свою запись?
SELECT 
  id,
  email,
  auth_user_id
FROM employees
WHERE auth_user_id = 'ВАШ_AUTH_USER_ID';
-- Должно вернуть вашу запись

-- ================================================================
-- Проверка 5: Почему политика может не работать?
-- ================================================================

-- Возможная причина 1: auth_user_id NULL или неправильный
SELECT 
  email,
  CASE 
    WHEN auth_user_id IS NULL THEN '❌ auth_user_id пустой!'
    ELSE '✅ auth_user_id заполнен'
  END as status,
  auth_user_id
FROM employees;

-- Возможная причина 2: В таблице auth.users есть этот пользователь?
SELECT 
  id as auth_user_id,
  email,
  created_at
FROM auth.users
ORDER BY created_at DESC;

-- Сравните: есть ли auth_user_id из employees в таблице auth.users?

-- ================================================================
-- РЕШЕНИЕ: Если auth_user_id не совпадает
-- ================================================================

-- Если auth_user_id в employees НЕ совпадает с id в auth.users,
-- нужно исправить:

-- Шаг 1: Найти правильный auth.users.id
SELECT id, email FROM auth.users WHERE email = 'ваш_email@example.com';

-- Шаг 2: Обновить employees.auth_user_id
-- UPDATE employees 
-- SET auth_user_id = 'правильный_uuid_из_auth_users'
-- WHERE email = 'ваш_email@example.com';

-- ================================================================
-- АЛЬТЕРНАТИВНОЕ РЕШЕНИЕ: Упростить политику
-- ================================================================

-- Вариант: Разрешить чтение ВСЕМ аутентифицированным пользователям
-- (менее безопасно, но гарантированно работает для теста)

-- DROP POLICY IF EXISTS "policy_employees_select_own" ON employees;
-- DROP POLICY IF EXISTS "policy_employees_select_owner" ON employees;

-- CREATE POLICY "policy_employees_select_all_authenticated"
-- ON employees
-- FOR SELECT
-- TO authenticated
-- USING (true);  -- Разрешить всем аутентифицированным

-- Это позволит войти, но все смогут видеть всех
-- Только для ТЕСТА!
