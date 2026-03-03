-- Конвертируем counter_type из ENUM в TEXT
-- Это позволит сохранять любые типы из таблицы counter_types без ограничений

-- Шаг 1: Меняем тип колонки с ENUM на TEXT
ALTER TABLE counters
  ALTER COLUMN counter_type TYPE TEXT USING counter_type::TEXT;

-- Шаг 2: Удаляем ENUM тип (если больше не используется)
DROP TYPE IF EXISTS counter_type_enum;
