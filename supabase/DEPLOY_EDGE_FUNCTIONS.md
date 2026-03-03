# Деплой Edge Functions в Supabase

Чтобы в базе сохранялись **Max ID**, **Телефон** и флаги **«Получать объявления»** (по Email, Telegram, Max ID), на Supabase должна быть задеплоена **актуальная** версия Edge Functions.

## 1. Миграции в БД (если ещё не выполняли)

В **Supabase → SQL Editor** по очереди выполните:

- `supabase/migrations/add_employees_max_id_phone.sql` — колонки `max_id`, `phone`
- `supabase/migrations/add_employees_notify_flags.sql` — колонки `notify_via_email`, `notify_via_telegram`, `notify_via_max`

## 2. Деплой функций

Из корня проекта (где лежит папка `supabase/`) в терминале:

```bash
npx supabase login
npx supabase link --projнect-ref ВАШ_PROJECT_REF
npx supabase functions deploy admin-update-user
npx supabase functions deploy admin-create-user
```

**Или через панель Supabase:**

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard) → ваш проект.
2. **Edge Functions** → выберите `admin-update-user` → загрузите код из папки `supabase/functions/admin-update-user/`.
3. То же для `admin-create-user`.

После деплоя при сохранении пользователя будут записываться:

- `max_id`, `phone`
- `notify_via_email`, `notify_via_telegram`, `notify_via_max` (галочки каналов уведомлений).
