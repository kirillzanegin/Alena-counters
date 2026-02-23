# Как выполнить SQL в Supabase через сайт (SQL Editor)

## Общие шаги

1. Откройте браузер и перейдите на **https://supabase.com/dashboard**
2. Войдите в аккаунт и выберите **ваш проект**
3. В левом меню нажмите **SQL Editor** (иконка `</>` или пункт «SQL Editor»)
4. Нажмите **New query** (или «+ New query»), чтобы создать новый запрос
5. Вставьте нужный SQL из списка ниже в поле ввода
6. Нажмите **Run** (или Ctrl+Enter)
7. Убедитесь, что внизу нет красной ошибки. Если есть — проверьте, что выполняете скрипты по порядку и что таблица/колонки ещё не созданы (можно использовать «IF NOT EXISTS» / «IF EXISTS» в скриптах ниже)

---

## Шаг 1. Таблица типов счётчиков (если ещё не делали)

Если таблицы `counter_types` нет — выполните этот блок целиком.

```sql
-- Таблица типов счётчиков
CREATE TABLE IF NOT EXISTS counter_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO counter_types (name, sort_order) VALUES
  ('ХВС 1', 1), ('ГВС 1', 2), ('ХВС 2', 3), ('ГВС 2', 4),
  ('ХВС 3', 5), ('ГВС 3', 6), ('Т1 день', 7), ('Т1 ночь', 8),
  ('Т2 день', 9), ('Т2 ночь', 10), ('Т3 день', 11), ('Т3 ночь', 12),
  ('Т внутр', 13), ('Т общий', 14), ('Т дублер', 15), ('Отопление', 16)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE counter_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can read counter_types" ON counter_types;
CREATE POLICY "anyone can read counter_types"
  ON counter_types FOR SELECT USING (true);
```

---

## Шаг 2. Таблица владельцев (owners) и поле у объектов

Новый запрос (New query), вставьте и Run:

```sql
-- Таблица владельцев
CREATE TABLE IF NOT EXISTS owners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can read owners" ON owners;
CREATE POLICY "anyone can read owners"
  ON owners FOR SELECT USING (true);

DROP POLICY IF EXISTS "authenticated can insert owners" ON owners;
CREATE POLICY "authenticated can insert owners"
  ON owners FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "authenticated can update owners" ON owners;
CREATE POLICY "authenticated can update owners"
  ON owners FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Поле владельца у объектов
ALTER TABLE objects
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES owners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_objects_owner_id ON objects(owner_id);
```

---

## Шаг 3. Поля Max ID и телефон у сотрудников (employees)

Новый запрос, вставьте и Run:

```sql
-- Max ID и телефон у сотрудников
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS max_id TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN employees.max_id IS 'Optional external/max identifier';
COMMENT ON COLUMN employees.phone IS 'Optional phone, e.g. +7 999 123-45-67';
```

---

## Шаг 4. Флаги «Получать объявления» у сотрудников

Новый запрос, вставьте и Run:

```sql
-- Каналы уведомлений для объявлений
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS notify_via_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_via_telegram BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_via_max BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN employees.notify_via_email IS 'Receive announcements via email when set';
COMMENT ON COLUMN employees.notify_via_telegram IS 'Receive announcements via Telegram when set';
COMMENT ON COLUMN employees.notify_via_max IS 'Receive announcements via Max ID when set';
```

---

## Краткая памятка

| Что делаете | Действие на сайте |
|-------------|-------------------|
| Открыть редактор | Dashboard → левое меню → **SQL Editor** |
| Новый запрос | Кнопка **New query** |
| Вставить SQL | Скопировать блок из этого файла и вставить в поле |
| Выполнить | Кнопка **Run** (или Ctrl+Enter) |
| Проверить | Внизу: зелёный результат или сообщение об ошибке |

После выполнения шагов 3 и 4 в таблице `employees` появятся колонки `max_id`, `phone`, `notify_via_email`, `notify_via_telegram`, `notify_via_max`. Чтобы в них начали записываться данные из приложения, нужно также задеплоить обновлённые Edge Functions (`admin-update-user`, `admin-create-user`) — см. `supabase/DEPLOY_EDGE_FUNCTIONS.md`.
