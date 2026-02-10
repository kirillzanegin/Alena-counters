# Что делать дальше? 🚀

## 1. Проверьте, что UI работает

```bash
# Запустите локальный сервер
py -m http.server 5173
```

Откройте `http://localhost:5173` и проверьте:
- ✅ Вход в систему работает
- ✅ Все плитки меню отображаются (включая "Telegram")
- ✅ Можно перейти в раздел "Telegram"

---

## 2. Создайте таблицу для токенов

Откройте [Supabase SQL Editor](https://app.supabase.com) и выполните:

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

---

## 3. Установите Supabase CLI

### Windows (PowerShell):
```powershell
# Установите через npm
npm install -g supabase
```

### Проверка:
```bash
supabase --version
```

---

## 4. Войдите в Supabase

```bash
supabase login
```

Откроется браузер для авторизации.

---

## 5. Свяжите проект

```bash
# Перейдите в папку проекта
cd "C:\Users\Admin\Downloads\Alena"

# Свяжите с вашим Supabase проектом
supabase link --project-ref YOUR_PROJECT_ID
```

**Где найти YOUR_PROJECT_ID:**
1. Откройте https://app.supabase.com
2. Выберите проект
3. URL будет: `https://app.supabase.com/project/YOUR_PROJECT_ID`
4. Скопируйте `YOUR_PROJECT_ID`

---

## 6. Деплой Edge Function

```bash
supabase functions deploy telegram-webhook --no-verify-jwt
```

После деплоя вы получите URL вида:
```
https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook
```

**Скопируйте этот URL!**

---

## 7. Настройте Telegram Webhook

Откройте в браузере (замените `YOUR_PROJECT_ID`):

```
https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/setWebhook?url=https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook
```

Должно вернуть:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

---

## 8. Проверьте webhook

Откройте в браузере:

```
https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/getWebhookInfo
```

Должно показать ваш URL в поле `"url"`.

---

## 9. Протестируйте привязку

1. Откройте приложение `http://localhost:5173`
2. Войдите в систему
3. Главное меню → "Telegram"
4. Нажмите "Привязать Telegram"
5. Перейдите по ссылке в бота
6. Бот должен подтвердить привязку ✅

---

## 10. Готово! 🎉

Теперь система полностью работает с Telegram интеграцией.

### Что можно делать:
- ✅ Привязывать/отвязывать Telegram аккаунты
- ✅ Получать уведомления (когда добавите в код)
- ✅ Использовать команды бота: `/status`, `/help`

---

## Troubleshooting

### Функция не деплоится
```bash
supabase functions list      # Проверить функции
supabase login              # Переавторизация
```

### Webhook не срабатывает
```bash
# Просмотр логов
supabase functions logs telegram-webhook --tail
```

Или в Dashboard: Project → Edge Functions → telegram-webhook → Logs

### Токен не находится
- Проверьте RLS политики в `telegram_link_tokens`
- Токен действителен только 1 час
- Убедитесь, что `employee_id` совпадает с текущим пользователем

---

## Полезные ссылки

- [Supabase Dashboard](https://app.supabase.com)
- [Telegram Bot: @money_cheking_bot](https://t.me/money_cheking_bot)
- [Документация Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Telegram Bot API](https://core.telegram.org/bots/api)

---

**Если нужна помощь — спрашивайте!** 😊
