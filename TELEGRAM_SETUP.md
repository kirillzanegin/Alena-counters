# Инструкция по настройке интеграции с Telegram

## Шаг 1: Подготовка базы данных

Выполните SQL в Supabase SQL Editor:

```sql
-- Таблица для временных токенов привязки Telegram
CREATE TABLE telegram_link_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE
);

-- Индексы для быстрого поиска
CREATE INDEX idx_telegram_link_tokens_token ON telegram_link_tokens(token);
CREATE INDEX idx_telegram_link_tokens_employee ON telegram_link_tokens(employee_id);

-- RLS политики
ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;

-- Пользователь может создавать свои токены
CREATE POLICY "Users can create their own tokens"
  ON telegram_link_tokens
  FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM employees WHERE id = employee_id));

-- Пользователь может читать свои токены
CREATE POLICY "Users can read their own tokens"
  ON telegram_link_tokens
  FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM employees WHERE id = employee_id));

-- Edge Function может обновлять токены (используя service_role key)
CREATE POLICY "Service role can update tokens"
  ON telegram_link_tokens
  FOR UPDATE
  USING (true);
```

## Шаг 2: Установка Supabase CLI

```bash
# Установите Supabase CLI (если ещё не установлен)
npm install -g supabase

# Или через Homebrew (macOS)
brew install supabase/tap/supabase
```

## Шаг 3: Логин в Supabase

```bash
# Войдите в аккаунт Supabase
supabase login
```

Откроется браузер для авторизации.

## Шаг 4: Связывание проекта

```bash
# Перейдите в папку проекта
cd "C:\Users\Admin\Downloads\Alena"

# Свяжите локальную папку с проектом Supabase
supabase link --project-ref YOUR_PROJECT_ID
```

**Где найти PROJECT_ID:**
- Откройте Supabase Dashboard
- URL будет вида: `https://app.supabase.com/project/YOUR_PROJECT_ID`
- Скопируйте `YOUR_PROJECT_ID`

## Шаг 5: Деплой Edge Function

```bash
# Деплой функции telegram-webhook
supabase functions deploy telegram-webhook --no-verify-jwt
```

Флаг `--no-verify-jwt` нужен, т.к. Telegram будет вызывать функцию напрямую без авторизации.

После деплоя вы получите URL функции:
```
https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook
```

## Шаг 6: Настройка Telegram Webhook

Выполните в браузере или через curl:

```bash
# Установите webhook для бота
curl -X POST "https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/setWebhook?url=https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook"
```

**Замените `YOUR_PROJECT_ID` на ваш Project ID!**

Ожидаемый ответ:
```json
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

## Шаг 7: Проверка webhook

```bash
# Проверьте статус webhook
curl "https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/getWebhookInfo"
```

Должно показать:
```json
{
  "ok": true,
  "result": {
    "url": "https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## Шаг 8: Тестирование

1. Откройте веб-приложение
2. Войдите в систему
3. Перейдите в раздел "Telegram"
4. Нажмите "Привязать Telegram"
5. Перейдите по ссылке в бота
6. Бот должен подтвердить привязку

## Просмотр логов Edge Function

```bash
# Просмотр логов в реальном времени
supabase functions serve telegram-webhook
```

Или в Supabase Dashboard:
- Project → Edge Functions → telegram-webhook → Logs

## Доступные команды бота

- `/start` - Начать работу с ботом
- `/start TOKEN` - Привязать аккаунт (автоматически из deep-link)
- `/help` - Показать справку
- `/status` - Проверить статус привязки

## Структура файлов

```
Alena/
├── supabase/
│   └── functions/
│       └── telegram-webhook/
│           └── index.ts          # Edge Function
├── app.js                        # Frontend приложение
├── index.html
└── TELEGRAM_SETUP.md             # Эта инструкция
```

## Troubleshooting

### Ошибка: "Failed to deploy function"
- Проверьте, что вы залогинены: `supabase login`
- Проверьте, что проект связан: `supabase link --project-ref YOUR_PROJECT_ID`

### Webhook не срабатывает
- Проверьте URL в `getWebhookInfo`
- Проверьте логи в Supabase Dashboard
- Убедитесь, что функция задеплоена: `supabase functions list`

### Токен не находится
- Проверьте RLS политики в таблице `telegram_link_tokens`
- Проверьте логи Edge Function
- Убедитесь, что токен не истёк (срок: 1 час)

## Безопасность

⚠️ **Важно:**
- Токен бота (`8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0`) захардкожен в Edge Function
- В production рекомендуется хранить его в Supabase Secrets:
  ```bash
  supabase secrets set TELEGRAM_BOT_TOKEN=8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0
  ```
  И использовать в коде:
  ```typescript
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") as string;
  ```

## Следующие шаги (будущее)

После успешной привязки можно добавить:
- ✅ Уведомления о критических событиях
- ✅ Напоминания о сроках подачи показаний
- ✅ Ввод показаний через бота
- ✅ Статистика через бота
