# Исправление: Проверка уникальности Telegram ID

## Проблема

Когда один Telegram аккаунт уже привязан к пользователю А, пользователь Б мог попытаться привязать тот же Telegram аккаунт. Система пыталась это сделать и выдавала ошибку или странное поведение.

## Что исправлено

### 1. В `app.js` - Автоматическая привязка при входе из Telegram

**До:**
```javascript
if (emp && autoBindTelegramId && !emp.tg_id) {
  // Привязывает сразу, без проверки
  supabase.from("employees").update({ tg_id: String(autoBindTelegramId) })
}
```

**После:**
```javascript
if (emp && autoBindTelegramId && !emp.tg_id) {
  // Сначала проверяем, не используется ли уже этот Telegram ID
  supabase.from("employees")
    .select("id, first_name, last_name, email")
    .eq("tg_id", String(autoBindTelegramId))
    .eq("is_active", true)
    .maybeSingle()
    .then(function (checkResult) {
      if (checkResult.data) {
        // Telegram уже привязан к другому пользователю
        setError("⚠️ Этот Telegram аккаунт уже привязан к другому пользователю...");
        return emp; // Возвращаем сотрудника БЕЗ привязки
      }
      // Telegram ID свободен, привязываем
      // ...
    });
}
```

### 2. В `telegram-webhook` Edge Function - Привязка через токен/ссылку

**До:**
```typescript
// Проверяли только: не привязан ли другой Telegram к ЭТОМУ сотруднику
if (employee.tg_id && employee.tg_id !== String(userId)) {
  // Ошибка
}
// Сразу привязываем
```

**После:**
```typescript
// Проверка 1: Не привязан ли другой Telegram к ЭТОМУ сотруднику
if (employee.tg_id && employee.tg_id !== String(userId)) {
  // Ошибка
}

// Проверка 2: Не используется ли ЭТОТ Telegram ID другим сотрудником (НОВОЕ!)
const { data: existingTelegramUser } = await supabase
  .from("employees")
  .select("id, first_name, last_name, email, is_active")
  .eq("tg_id", String(userId))
  .eq("is_active", true)
  .maybeSingle();

if (existingTelegramUser && existingTelegramUser.id !== employee.id) {
  await sendTelegramMessage(
    chatId,
    "⚠️ Этот Telegram аккаунт уже используется!\n\n" +
    "Привязан к пользователю: ..."
  );
  return;
}

// Только после проверок - привязываем
```

## Сценарии использования

### Сценарий 1: Пользователь А привязал Telegram, пользователь Б пытается войти из того же Telegram

1. Пользователь А: Telegram ID `123456` → привязан к `user_a@example.com` ✅
2. Пользователь Б: Открывает мини-приложение из того же Telegram (ID `123456`)
3. Пользователь Б: Входит как `user_b@example.com`
4. **Результат (ДО)**: Telegram ID перепривязывается к пользователю Б 😱
5. **Результат (ПОСЛЕ)**: Показывается ошибка: "⚠️ Этот Telegram аккаунт уже привязан к другому пользователю (user_a@example.com)" ✅

### Сценарий 2: Пользователь Б пытается привязать Telegram через ссылку/токен

1. Пользователь А: Telegram ID `123456` → привязан к `user_a@example.com` ✅
2. Пользователь Б: В веб-приложении нажимает "Привязать Telegram"
3. Пользователь Б: Копирует ссылку и открывает в Telegram с ID `123456`
4. Бот получает `/start TOKEN` от пользователя с ID `123456`
5. **Результат (ДО)**: Попытка перепривязки, ошибка в базе данных 😱
6. **Результат (ПОСЛЕ)**: Бот отвечает: "⚠️ Этот Telegram аккаунт уже используется! Привязан к пользователю: user_a@example.com" ✅

## Что нужно сделать

### 1. Обновить Edge Function

1. Откройте Supabase Dashboard → Edge Functions → telegram-webhook
2. Deploy new version
3. Скопируйте обновлённый код из `supabase\functions\telegram-webhook\index.ts`
4. Вставьте и сохраните

### 2. Загрузить обновлённый app.js на GitHub Pages

```bash
cd c:\Users\Admin\Downloads\Alena
git add app.js supabase/functions/telegram-webhook/index.ts
git commit -m "Fix: Check Telegram ID uniqueness before binding"
git push origin main
```

Подождите 1-2 минуты для обновления GitHub Pages.

### 3. Тестирование

#### Тест 1: Повторная привязка того же Telegram (автоматически)

1. Пользователь А уже привязал Telegram
2. Выйдите из аккаунта
3. Войдите как пользователь Б из того же Telegram (мини-приложение)
4. **Ожидаемый результат**: Ошибка "⚠️ Этот Telegram аккаунт уже привязан к другому пользователю..."

#### Тест 2: Повторная привязка того же Telegram (через ссылку)

1. Пользователь А уже привязал Telegram (ID `123456`)
2. Войдите как пользователь Б (в браузере, НЕ из Telegram)
3. Нажмите "Привязать Telegram"
4. Скопируйте ссылку и откройте в Telegram с ID `123456`
5. **Ожидаемый результат**: Бот отвечает "⚠️ Этот Telegram аккаунт уже используется!"

#### Тест 3: Нормальная привязка нового Telegram

1. Войдите как пользователь без привязки
2. Откройте мини-приложение из НОВОГО Telegram (который нигде не используется)
3. Войдите в систему
4. **Ожидаемый результат**: ✅ Telegram привязан успешно!

## Безопасность

✅ Один Telegram аккаунт = один пользователь системы  
✅ Невозможно "украсть" чужую привязку  
✅ Понятные сообщения об ошибках для пользователя  
✅ Защита как при автоматической привязке, так и при ручной  

## Отвязка Telegram

Если нужно перепривязать Telegram к другому пользователю:

1. Войдите как пользователь А (у которого сейчас привязан Telegram)
2. Перейдите в раздел "Telegram"
3. Нажмите "Отвязать Telegram"
4. Теперь этот Telegram ID освободился
5. Пользователь Б может его привязать

Готово! 🎉
