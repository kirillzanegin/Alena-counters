-- Функция для исправления auth_user_id у сотрудника по его email.
-- Вызывается при входе, если сотрудник нашёлся по email, но не по auth_user_id
-- (например, после пересоздания пользователя в Supabase Auth).
-- SECURITY DEFINER — обходит RLS, но строго ограничена:
-- обновляет только auth_user_id, только для строки с совпадающим email из JWT.

CREATE OR REPLACE FUNCTION heal_auth_user_id()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_email text;
  v_jwt_sub   text;
BEGIN
  v_jwt_email := auth.jwt() ->> 'email';
  v_jwt_sub   := auth.jwt() ->> 'sub';

  IF v_jwt_email IS NULL OR v_jwt_sub IS NULL THEN
    RETURN false;
  END IF;

  UPDATE employees
  SET auth_user_id = v_jwt_sub
  WHERE LOWER(email) = LOWER(v_jwt_email)
    AND is_active = true
    AND (auth_user_id IS NULL OR auth_user_id <> v_jwt_sub);

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION heal_auth_user_id() TO authenticated;
