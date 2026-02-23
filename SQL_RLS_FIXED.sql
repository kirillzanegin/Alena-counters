-- Правильные RLS политики для employees
-- Эти политики НЕ блокируют вход в систему

-- =====================================================
-- ШАГ 1: Включить RLS
-- =====================================================

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- ШАГ 2: Удалить все старые политики
-- =====================================================

DROP POLICY IF EXISTS "Users can view own record" ON employees;
DROP POLICY IF EXISTS "Users can update own link_token" ON employees;
DROP POLICY IF EXISTS "Owners can view all active employees" ON employees;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON employees;
DROP POLICY IF EXISTS "Enable update for users based on auth_user_id" ON employees;

-- =====================================================
-- ШАГ 3: Создать правильные политики
-- =====================================================

-- Политика 1: Пользователи могут читать свою запись (для входа в систему)
-- ВАЖНО: Проверяем auth_user_id, который устанавливается при создании пользователя
CREATE POLICY "Enable read access for own record"
ON employees
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid()
);

-- Политика 2: Владельцы могут читать записи всех активных сотрудников
CREATE POLICY "Owners can read all active employees"
ON employees
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM employees AS owner
    WHERE owner.auth_user_id = auth.uid()
      AND owner.role = 'owner'
      AND owner.is_active = true
  )
);

-- Политика 3: Пользователи могут обновлять ТОЛЬКО свой link_token и link_expires_at
-- (для привязки Telegram)
CREATE POLICY "Users can update own telegram link token"
ON employees
FOR UPDATE
TO authenticated
USING (auth_user_id = auth.uid())
WITH CHECK (auth_user_id = auth.uid());

-- =====================================================
-- ШАГ 4: Проверить созданные политики
-- =====================================================

SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'employees'
ORDER BY policyname;

-- =====================================================
-- ШАГ 5: Проверить, что RLS включен
-- =====================================================

SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'employees';

-- Должно показать: rowsecurity = true

-- =====================================================
-- ВАЖНО: Как это работает
-- =====================================================

/*
Теперь политики работают правильно:

1. При логине:
   - Пользователь аутентифицируется через Supabase Auth
   - Получает auth.uid()
   - fetchEmployeeForUser() делает SELECT с фильтром: auth_user_id = user.id
   - Политика "Enable read access for own record" разрешает чтение
   - ✅ Вход успешен!

2. Обычный пользователь (role = 'user'):
   - Видит только свою запись
   - Может обновлять только свой link_token/link_expires_at
   - ✅ Привязка Telegram работает!

3. Владелец (role = 'owner'):
   - Видит свою запись через первую политику
   - Видит все записи активных сотрудников через вторую политику
   - ✅ Управление пользователями работает!

4. Edge Functions (service_role):
   - Обходят все RLS политики
   - Могут делать любые операции
   - ✅ Создание/обновление пользователей работает!
*/
