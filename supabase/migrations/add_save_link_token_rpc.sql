-- Функция для сохранения link_token от имени самого пользователя.
-- SECURITY DEFINER позволяет обойти RLS, но функция строго ограничена:
-- обновляет только link_token и link_expires_at, только для своей строки.

CREATE OR REPLACE FUNCTION save_link_token(
  p_employee_id bigint,
  p_token        text,
  p_expires_at   timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_email text;
  v_jwt_email      text;
BEGIN
  v_jwt_email := auth.jwt() ->> 'email';

  SELECT email INTO v_employee_email
  FROM employees
  WHERE id = p_employee_id AND is_active = true;

  -- Запрещаем обновлять чужие строки
  IF v_employee_email IS NULL OR v_employee_email <> v_jwt_email THEN
    RETURN false;
  END IF;

  UPDATE employees
  SET link_token      = p_token,
      link_expires_at = p_expires_at
  WHERE id = p_employee_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION save_link_token(integer, text, timestamptz) TO authenticated;
