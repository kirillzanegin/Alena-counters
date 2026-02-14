-- Шаг 2 Roadmap: привязка объектов к пользователю (роль User видит только свои объекты)
-- Выполнить в Supabase: SQL Editor → New query → вставить и Run

-- В каждом объекте можно указать, какому пользователю (роль user) он доступен.
-- Владелец (owner) видит все объекты; пользователь (user) — только объекты, где assigned_employee_id = его id.

ALTER TABLE objects
ADD COLUMN IF NOT EXISTS assigned_employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN objects.assigned_employee_id IS 'Сотрудник с ролью user, которому доступен этот объект. NULL = не назначен (только владелец видит).';

-- Индекс для быстрой фильтрации списка объектов по пользователю
CREATE INDEX IF NOT EXISTS idx_objects_assigned_employee_id ON objects(assigned_employee_id);
