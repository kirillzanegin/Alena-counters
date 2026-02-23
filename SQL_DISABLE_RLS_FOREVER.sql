-- СРОЧНО: Отключить RLS навсегда (для этого проекта)

ALTER TABLE employees DISABLE ROW LEVEL SECURITY;

-- Проверка
SELECT 
  tablename,
  rowsecurity as "RLS отключен (должно быть false)"
FROM pg_tables
WHERE tablename = 'employees';

-- Готово! RLS отключен, теперь приложение будет работать
