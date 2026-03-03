-- ШАГ 1: Удаляем все существующие политики на таблице employees
-- (они вызывают бесконечную рекурсию)
DO $$
DECLARE
    pol text;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies WHERE tablename = 'employees' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON employees', pol);
    END LOOP;
END$$;

-- ШАГ 2: Создаём функцию SECURITY DEFINER
-- Она обходит RLS при вызове, поэтому рекурсии не будет
CREATE OR REPLACE FUNCTION get_current_employee_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role
  FROM employees
  WHERE email = (auth.jwt() ->> 'email')
    AND is_active = true
  LIMIT 1;
$$;

-- ШАГ 3: Даём права на вызов функции
GRANT EXECUTE ON FUNCTION get_current_employee_role() TO authenticated;

-- ШАГ 4: Создаём политики без рекурсии

-- Каждый аутентифицированный пользователь видит только свою запись
CREATE POLICY "employees_read_own"
  ON employees FOR SELECT
  TO authenticated
  USING (email = (auth.jwt() ->> 'email'));

-- Владелец (owner) видит всех сотрудников
CREATE POLICY "employees_read_all_as_owner"
  ON employees FOR SELECT
  TO authenticated
  USING (get_current_employee_role() = 'owner');

-- Владелец может создавать сотрудников
CREATE POLICY "employees_insert_as_owner"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (get_current_employee_role() = 'owner');

-- Владелец может редактировать сотрудников
CREATE POLICY "employees_update_as_owner"
  ON employees FOR UPDATE
  TO authenticated
  USING (get_current_employee_role() = 'owner')
  WITH CHECK (get_current_employee_role() = 'owner');

-- ШАГ 5: Убеждаемся что RLS включён
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
