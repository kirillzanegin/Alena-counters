# Быстрый деплой Telegram интеграции

## Шаг 1: SQL в Supabase

Скопируйте и выполните в Supabase SQL Editor:

```sql
CREATE TABLE telegram_link_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_telegram_link_tokens_token ON telegram_link_tokens(token);
CREATE INDEX idx_telegram_link_tokens_employee ON telegram_link_tokens(employee_id);

ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create their own tokens" ON telegram_link_tokens FOR INSERT WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM employees WHERE id = employee_id));
CREATE POLICY "Users can read their own tokens" ON telegram_link_tokens FOR SELECT USING (auth.uid() IN (SELECT auth_user_id FROM employees WHERE id = employee_id));
CREATE POLICY "Service role can update tokens" ON telegram_link_tokens FOR UPDATE USING (true);
```

## Шаг 2: Деплой Edge Function

```bash
# 1. Установите Supabase CLI (если нет)
npm install -g supabase

# 2. Войдите в аккаунт
supabase login

# 3. Перейдите в папку проекта
cd "C:\Users\Admin\Downloads\Alena"

# 4. Свяжите с проектом (замените YOUR_PROJECT_ID)
supabase link --project-ref YOUR_PROJECT_ID

# 5. Деплой функции
supabase functions deploy telegram-webhook --no-verify-jwt
```

После деплоя вы получите URL:
```
https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook
```

## Шаг 3: Настройка Telegram Webhook

Выполните в браузере (замените `YOUR_PROJECT_ID`):

```
https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/setWebhook?url=https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook
```

Или через PowerShell:

```powershell
curl -X POST "https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/setWebhook?url=https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook"
```

## Шаг 4: Проверка

```
https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/getWebhookInfo
```

Должно показать ваш URL в поле `"url"`.

## Шаг 5: Тест

1. Откройте приложение → Telegram → "Привязать Telegram"
2. Перейдите в бота
3. Бот подтвердит привязку

**Готово!** 🎉

---

## Найти YOUR_PROJECT_ID

1. Откройте [Supabase Dashboard](https://app.supabase.com)
2. Выберите ваш проект
3. URL будет: `https://app.supabase.com/project/YOUR_PROJECT_ID`
4. Скопируйте `YOUR_PROJECT_ID` из URL

---

## Troubleshooting

### Функция не деплоится
```bash
supabase functions list  # Проверить список функций
supabase login           # Переавторизоваться
```

### Webhook не работает
```bash
# Проверьте логи
supabase functions logs telegram-webhook --tail
```

Или в Dashboard: Project → Edge Functions → telegram-webhook → Logs

### Токен не находится
- Проверьте RLS политики в таблице `telegram_link_tokens`
- Токен действителен только 1 час
