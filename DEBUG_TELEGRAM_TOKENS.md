# Отладка проблемы с токенами Telegram

## Что мы добавили

Добавили детальное логирование в код, чтобы понять, где именно происходит проблема.

## Шаги для отладки

### 1. Задеплоить обновлённую Edge Function

Скопируйте весь код из файла `supabase\functions\telegram-webhook\index.ts` и вставьте в Supabase Dashboard:

1. Откройте https://supabase.com → ваш проект
2. Edge Functions → telegram-webhook
3. Deploy new version
4. Вставьте код
5. Deploy

### 2. Загрузить обновлённый app.js на GitHub Pages

```bash
git add app.js supabase/functions/telegram-webhook/index.ts
git commit -m "Add debug logging for Telegram linking"
git push origin main
```

Подождите 1-2 минуты для обновления GitHub Pages.

### 3. Тестирование с логами

#### А. Проверка генерации токена (в браузере)

1. Откройте ваш сайт в браузере
2. Нажмите F12 (открыть консоль разработчика)
3. Перейдите на вкладку "Console"
4. Войдите в систему
5. Перейдите в раздел "Telegram"
6. Нажмите "Привязать Telegram"

**Что смотреть в консоли:**
```
🔑 Generating token: abc123xyz...
⏰ Expires at: 2026-02-10T...
👤 Employee ID: 2
📝 Update result: {...}
✅ Token saved successfully: abc123xyz...
```

**Если видите ошибку** - скопируйте её и отправьте мне.

#### Б. Проверка в базе данных

1. Откройте Supabase Dashboard → Table Editor → employees
2. Найдите вашу запись
3. Проверьте колонки:
   - `link_token` - должен быть заполнен
   - `link_expires_at` - должна быть дата/время

**Сделайте скриншот этой строки** (можно замазать email)

#### В. Проверка получения токена ботом

1. Скопируйте ссылку из приложения (например: `https://t.me/money_cheking_bot?start=abc123xyz`)
2. Откройте её в Telegram
3. Зайдите в Supabase Dashboard → Edge Functions → telegram-webhook → Logs

**Что смотреть в логах:**
```
🔍 Received token: abc123xyz
🔍 Database search result: { employee: {...}, tokenError: null }
```

**Или если ошибка:**
```
❌ Token not found or error: ...
📋 All employees with tokens: [...]
```

**Скопируйте логи** и отправьте мне.

## Возможные проблемы и решения

### Проблема 1: Колонки link_token и link_expires_at не существуют

**Решение**: Запустите SQL снова:
```sql
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS link_token TEXT,
ADD COLUMN IF NOT EXISTS link_expires_at TIMESTAMP WITH TIME ZONE;
```

### Проблема 2: RLS (Row Level Security) блокирует обновление

**Решение**: Проверьте политики RLS для таблицы employees:

```sql
-- Временно отключить RLS для теста (НЕ для продакшена!)
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
```

Или создайте политику:
```sql
CREATE POLICY "Allow employees update own link_token"
ON employees
FOR UPDATE
USING (auth.uid() = auth_user_id)
WITH CHECK (auth.uid() = auth_user_id);
```

### Проблема 3: Токен создаётся, но бот его не находит

**Причины:**
- Токен в URL кодируется/декодируется неправильно
- Проблема с регистром (uppercase/lowercase)
- Лишние пробелы или символы

**Решение**: Смотрим логи Edge Function (шаг В выше)

## Что делать дальше

После выполнения всех шагов отправьте мне:
1. ✅ Скриншот консоли браузера (Console в DevTools)
2. ✅ Скриншот строки employees из базы данных
3. ✅ Логи из Edge Function (telegram-webhook)

С этой информацией я смогу точно определить проблему!
