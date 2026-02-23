# Как предотвратить сброс Telegram webhook

Иногда webhook Telegram бота может сброситься (стать пустым). Причины:

1. **Ручной вызов `deleteWebhook`** (по ошибке или через другой скрипт/бота).
2. **Другой деплой функции** на тот же URL с изменёнными параметрами.
3. **Ошибки Telegram API** при обработке запросов (редко).

---

## Решение 1: Проверять webhook при запуске бота / периодически

Можно настроить **Supabase Cron Job** (pg_cron или функцию по расписанию), которая раз в час или раз в сутки будет:

1. Проверять `getWebhookInfo`.
2. Если `url` пустой или неверный — вызывать `setWebhook` заново.

Пример кода для Edge Function (создать новую `check-telegram-webhook`):

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BOT_TOKEN = "8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0";
const EXPECTED_URL = "https://ervtmgbehtwdscvbnvio.supabase.co/functions/v1/telegram-webhook";

serve(async () => {
  try {
    const info = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const data = await info.json();

    const currentUrl = data?.result?.url || "";

    if (currentUrl !== EXPECTED_URL) {
      console.log("Webhook is missing or incorrect, resetting...");
      const setResult = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${EXPECTED_URL}`
      );
      const setData = await setResult.json();
      
      if (setData.ok) {
        return new Response(JSON.stringify({ ok: true, message: "Webhook reset successfully" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } else {
        return new Response(JSON.stringify({ ok: false, error: setData }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, message: "Webhook is correct" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

Затем в Supabase:

- **Database** → **Functions & Extensions** → включить **pg_cron** (если доступно).
- Или создать **GitHub Action** / внешний сервис (например, UptimeRobot), который раз в час вызывает эту функцию.

---

## Решение 2: Проверять webhook в начале каждого дня вручную

Добавить себе напоминание раз в день/неделю открывать:

```
https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/getWebhookInfo
```

Если `url` пустой — выполнить:

```
https://api.telegram.org/bot8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0/setWebhook?url=https://ervtmgbehtwdscvbnvio.supabase.co/functions/v1/telegram-webhook
```

Можно сохранить эти две ссылки в закладки браузера.

---

## Решение 3: Логирование и алерты

- В Supabase включить **мониторинг** для функции `telegram-webhook`.
- Если число запросов к ней резко упало до 0, а бот используется — webhook, вероятно, сброшен.

Для этого можно настроить **Webhooks** или интеграцию с внешними системами мониторинга (например, Discord, Slack, Email).

---

## Важно

- **Не деплойте** функцию `telegram-webhook` с флагом **`--verify-jwt`** без `--no-verify-jwt` (иначе Telegram не сможет её вызвать).
- **Не вызывайте** `deleteWebhook` случайно (если экспериментируете с API).
- **Не запускайте** другие скрипты/ботов на тот же токен, которые могут переустановить webhook на другой URL.

---

## Краткий итог

1. Создать Edge Function **check-telegram-webhook** (код выше).
2. Настроить запуск функции по расписанию (раз в час/сутки через pg_cron, GitHub Action или UptimeRobot).
3. Функция проверяет `getWebhookInfo`, если URL неверный — вызывает `setWebhook` заново.
4. Если webhook сбросился — он восстановится автоматически в течение часа (или другого интервала).

Альтернатива: сохранить ссылки на `getWebhookInfo` и `setWebhook` в закладках и проверять вручную раз в день/неделю.
