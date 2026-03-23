-- RPC: безопасный поиск сотрудника для текущего аутентифицированного пользователя.
-- SECURITY DEFINER — обходит RLS, но строго ограничен:
--   1. Ищет по auth_user_id (быстрый путь).
--   2. Если не найден — ищет по email без учёта регистра (решает проблему с заглавными буквами).
--   3. При нахождении по email автоматически исправляет auth_user_id (само-восстановление).
-- Возвращает одну строку с данными сотрудника или ничего.

CREATE OR REPLACE FUNCTION get_employee_for_auth_user()
RETURNS TABLE(
  id           bigint,
  first_name   text,
  last_name    text,
  is_active    boolean,
  tg_id        text,
  role         text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub   text;
  v_email text;
  v_row   employees%ROWTYPE;
BEGIN
  v_sub   := auth.jwt() ->> 'sub';
  v_email := auth.jwt() ->> 'email';

  IF v_sub IS NULL THEN
    RETURN;
  END IF;

  -- Шаг 1: ищем по auth_user_id
  SELECT * INTO v_row FROM employees WHERE auth_user_id = v_sub LIMIT 1;

  -- Шаг 2: если не нашли — ищем по email (без учёта регистра)
  IF NOT FOUND AND v_email IS NOT NULL THEN
    SELECT * INTO v_row
    FROM employees
    WHERE LOWER(email) = LOWER(v_email)
    LIMIT 1;

    -- Исправляем auth_user_id, чтобы следующий вход работал напрямую
    IF FOUND THEN
      UPDATE employees SET auth_user_id = v_sub WHERE id = v_row.id;
    END IF;
  END IF;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT v_row.id, v_row.first_name, v_row.last_name,
           v_row.is_active, v_row.tg_id, v_row.role;
END;
$$;

GRANT EXECUTE ON FUNCTION get_employee_for_auth_user() TO authenticated;
