-- ================================================================
-- ФИНАЛЬНАЯ ВЕРСИЯ: RLS с правильными ограничениями
-- Используйте ТОЛЬКО если SQL_RLS_TEST_SIMPLE.sql работает!
-- ================================================================

-- Шаг 1: Удалить тестовую политику
DROP POLICY IF EXISTS "allow_all_authenticated" ON employees;

-- Шаг 2: Создать правильные политики с ограничениями

-- Политика 1: SELECT - Каждый видит только свою запись
CREATE POLICY "rls_employees_select_own"
ON employees
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid() 
  AND is_active = true
);

-- Политика 2: SELECT - Владельцы видят всех активных сотрудников
CREATE POLICY "rls_employees_select_owner"
ON employees
FOR SELECT
TO authenticated
USING (
  is_active = true
  AND EXISTS (
    SELECT 1 
    FROM employees AS owner
    WHERE owner.auth_user_id = auth.uid()
      AND owner.role = 'owner'
      AND owner.is_active = true
  )
);

-- Политика 3: UPDATE - Каждый может обновлять только свою запись
CREATE POLICY "rls_employees_update_own"
ON employees
FOR UPDATE
TO authenticated
USING (
  auth_user_id = auth.uid() 
  AND is_active = true
)
WITH CHECK (
  auth_user_id = auth.uid()
  AND is_active = true
);

-- ================================================================
-- ПРОВЕРКА
-- ================================================================

SELECT 
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'employees'
ORDER BY policyname;

-- Должно показать 3 политики:
-- 1. rls_employees_select_own (SELECT)
-- 2. rls_employees_select_owner (SELECT)
-- 3. rls_employees_update_own (UPDATE)

-- ================================================================
-- КАК ЭТО РАБОТАЕТ
-- ================================================================

/*
✅ Обычный пользователь (role = 'user'):
   - Видит ТОЛЬКО свою запись
   - Может обновлять ТОЛЬКО свою запись
   - НЕ видит других пользователей

✅ Владелец (role = 'owner'):
   - Видит свою запись (через политику 1)
   - Видит ВСЕ записи активных сотрудников (через политику 2)
   - Может обновлять ТОЛЬКО свою запись
   - Создание/обновление других через Edge Functions (service_role)

✅ Edge Functions (service_role):
   - Обходят RLS полностью
   - Могут создавать/обновлять/удалять любые записи

🔒 Безопасность:
   - Один пользователь не может читать данные другого
   - Один пользователь не может изменять данные другого
   - Деактивированные пользователи (is_active = false) невидимы
*/

-- ================================================================
-- ТЕСТИРОВАНИЕ
-- ================================================================

/*
1. Войдите как обычный пользователь:
   - Должно пускать
   - В разделе "Telegram" должна быть кнопка "Привязать Telegram"

2. Войдите как владелец:
   - Должно пускать
   - В "Управление пользователями" должны видеть всех сотрудников
   - Должна работать кнопка "Создать учётную запись"

3. Привяжите Telegram:
   - Должно работать без ошибок

Если всё работает - RLS настроен правильно! ✅
*/
