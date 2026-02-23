# Бот не отвечает на /start — что проверить

Если при нажатии кнопки «Start» в Telegram бот ничего не присылает, проверьте по шагам ниже.

---

## 1. Webhook установлен и указывает на вашу функцию

Telegram отправляет все обновления (в т.ч. /start) на один URL. Если webhook не настроен или указан не тот адрес — бот не получит команду и не ответит.

**Проверка:** откройте в браузере:

```
https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/getWebhookInfo
```

В ответе должно быть что-то вроде:

```json
{
  "ok": true,
  "result": {
    "url": "https://ervtmgbehtwdscvbnvio.supabase.co/functions/v1/telegram-webhook"
  }
}
```

(Адрес должен совпадать с вашим проектом Supabase; в приложении используется `ervtmgbehtwdscvbnvio`.)

- Если **`url` пустой** или **нет поля `url`** — webhook не установлен.  
- Если **`url` другой** (не ваш Supabase) — установлен старый/чужой webhook.

**Исправление — установить webhook вручную:**

Откройте в браузере (для вашего проекта URL такой):

```
https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/setWebhook?url=https://ervtmgbehtwdscvbnvio.supabase.co/functions/v1/telegram-webhook
```

Если используете другой проект Supabase — замените `ervtmgbehtwdscvbnvio` на свой Reference ID (Dashboard → Project Settings → General).

В ответе должно быть `"ok": true`. После этого снова отправьте боту `/start`.

---

## 2. Edge Function задеплоена и вызывается

- В **Supabase Dashboard** откройте **Edge Functions** и убедитесь, что есть функция **telegram-webhook**.
- Если её нет — задеплойте из папки проекта:

```powershell
cd "C:\Users\Admin\Downloads\Alena"
supabase login
supabase link --project-ref ВАШ_PROJECT_REF
supabase functions deploy telegram-webhook --no-verify-jwt
```

После деплоя снова установите webhook (шаг 1), затем проверьте `/start`.

---

## 3. У функции отключена проверка JWT (Verify JWT = OFF)

Telegram шлёт запросы **без** заголовка Authorization. Если у Edge Function включён **Verify JWT**, Supabase вернёт 401 и запрос до кода бота не дойдёт — бот «молчит».

**Что сделать:**

1. Supabase Dashboard → **Edge Functions** → **telegram-webhook**.
2. Откройте настройки функции (Settings / Details).
3. Найдите опцию **Verify JWT** и выключите её (**OFF**).

Деплой с флагом `--no-verify-jwt` тоже отключает проверку JWT при публикации.

---

## 4. Таблица и политики для кодов из Telegram

При первом `/start` (без токена) бот создаёт 6-значный код и пишет его в таблицу `telegram_link_tokens` с `employee_id = NULL`. Если таблица или RLS к этому не готовы, вставка падает и пользователь может не получить ответ.

**Что сделать:** в Supabase выполните SQL из файла:

**`SQL_UPDATE_TELEGRAM_TOKENS.sql`**

Там:

- добавляется колонка `tg_id` (если её нет);
- `employee_id` делается nullable;
- обновляются RLS-политики под оба способа привязки (из приложения и из Telegram).

Без этого шага при определённых настройках таблицы бот может не суметь сохранить код и не ответить или ответить ошибкой.

---

## 5. Логи Edge Function

Если webhook и JWT настроены, но ответа всё равно нет — посмотрите логи:

- **Supabase Dashboard** → **Edge Functions** → **telegram-webhook** → вкладка **Logs**.

Отправьте боту `/start` и сразу обновите логи. Должны появиться строки вроде:

- `Received update: ...` — запрос от Telegram доходит до функции.
- Дальше могут быть ошибки (например, от БД или отправки сообщения).

Если в логах **ничего нет** при нажатии Start — запросы до Supabase не доходят: снова проверьте webhook (шаг 1) и то, что в `getWebhookInfo` указан именно ваш URL.

---

## Краткий чеклист

| Шаг | Действие |
|-----|----------|
| 1 | Открыть `getWebhookInfo` и убедиться, что `url` = ваш `.../telegram-webhook`. |
| 2 | Если webhook пустой/неверный — вызвать `setWebhook?url=...` с правильным URL. |
| 3 | В Edge Functions убедиться, что **telegram-webhook** задеплоена. |
| 4 | У функции **telegram-webhook** отключить **Verify JWT**. |
| 5 | Выполнить **SQL_UPDATE_TELEGRAM_TOKENS.sql** в Supabase. |
| 6 | Проверить логи функции при отправке `/start`. |

После этого снова нажмите Start в боте — должен прийти ответ с кодом или кнопкой «Открыть приложение».
