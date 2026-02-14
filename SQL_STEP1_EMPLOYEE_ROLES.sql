-- Шаг 1 Roadmap: роли в БД (Owner vs User)
-- Выполнить в Supabase: SQL Editor → New query → вставить и Run

-- Добавить колонку role в employees
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Допустимые значения: 'owner' (владелец) и 'user' (пользователь)
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (role IN ('owner', 'user'));

-- Существующих сотрудников оставляем с role = 'user'.
-- Одному (или нескольким) вручную назначьте владельца в Table Editor:
--   UPDATE employees SET role = 'owner' WHERE id = <id>;
-- или для первого сотрудника:
--   UPDATE employees SET role = 'owner' WHERE id = (SELECT id FROM employees LIMIT 1);

COMMENT ON COLUMN employees.role IS 'Роль: owner (владелец, полный доступ) или user (пользователь, ограниченный доступ).';
