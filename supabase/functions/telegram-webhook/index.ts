// Supabase Edge Function для обработки Telegram webhook
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = "8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TelegramUpdate {
  message?: {
    from?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    text?: string;
    chat?: {
      id: number;
    };
  };
}

async function sendTelegramMessage(chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
    }),
  });
}

serve(async (req: Request) => {
  try {
    // Разрешаем только POST запросы от Telegram
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const update: TelegramUpdate = await req.json();
    console.log("Received update:", JSON.stringify(update));

    const message = update.message;
    if (!message || !message.text || !message.from) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat?.id;
    const userId = message.from.id;
    const text = message.text.trim();
    const firstName = message.from.first_name || "";
    const lastName = message.from.last_name || "";

    // Обработка команды /start с токеном
    if (text.startsWith("/start ")) {
      const token = text.substring(7).trim();
      
      if (!token) {
        await sendTelegramMessage(
          chatId,
          "❌ Некорректный токен привязки.\n\nПолучите новый токен в веб-приложении."
        );
        return new Response("OK", { status: 200 });
      }

      // Ищем токен в базе
      const { data: tokenData, error: tokenError } = await supabase
        .from("telegram_link_tokens")
        .select("*, employees(*)")
        .eq("token", token)
        .eq("used", false)
        .single();

      if (tokenError || !tokenData) {
        console.error("Token not found:", tokenError);
        await sendTelegramMessage(
          chatId,
          "❌ Токен не найден или уже использован.\n\nПолучите новый токен в веб-приложении."
        );
        return new Response("OK", { status: 200 });
      }

      // Проверяем срок действия токена
      const expiresAt = new Date(tokenData.expires_at);
      const now = new Date();
      
      if (now > expiresAt) {
        await sendTelegramMessage(
          chatId,
          "⏰ Токен истёк.\n\nПолучите новый токен в веб-приложении."
        );
        return new Response("OK", { status: 200 });
      }

      // Проверяем, не привязан ли уже другой Telegram к этому сотруднику
      if (tokenData.employees.tg_id && tokenData.employees.tg_id !== String(userId)) {
        await sendTelegramMessage(
          chatId,
          "⚠️ К этому аккаунту уже привязан другой Telegram.\n\nСначала отвяжите старый аккаунт в веб-приложении."
        );
        return new Response("OK", { status: 200 });
      }

      // Привязываем Telegram ID к сотруднику
      const { error: updateError } = await supabase
        .from("employees")
        .update({ tg_id: String(userId) })
        .eq("id", tokenData.employee_id);

      if (updateError) {
        console.error("Failed to update employee:", updateError);
        await sendTelegramMessage(
          chatId,
          "❌ Ошибка при привязке аккаунта.\n\nПопробуйте позже."
        );
        return new Response("OK", { status: 200 });
      }

      // Отмечаем токен как использованный
      await supabase
        .from("telegram_link_tokens")
        .update({ used: true })
        .eq("id", tokenData.id);

      // Отправляем успешное сообщение
      const employeeName = tokenData.employees.first_name 
        ? `${tokenData.employees.first_name} ${tokenData.employees.last_name || ""}`.trim()
        : tokenData.employees.email;

      await sendTelegramMessage(
        chatId,
        `✅ <b>Аккаунт успешно привязан!</b>\n\n` +
        `Сотрудник: ${employeeName}\n` +
        `Email: ${tokenData.employees.email}\n\n` +
        `Теперь вы будете получать уведомления от системы Энергомониторинг.`
      );

      return new Response("OK", { status: 200 });
    }

    // Обработка команды /start без токена (НОВЫЙ СПОСОБ)
    if (text === "/start") {
      // Проверяем, не привязан ли уже этот Telegram ID
      const { data: existingEmployee } = await supabase
        .from("employees")
        .select("*")
        .eq("tg_id", String(userId))
        .single();

      if (existingEmployee) {
        const name = existingEmployee.first_name 
          ? `${existingEmployee.first_name} ${existingEmployee.last_name || ""}`.trim()
          : "Не указано";
        
        await sendTelegramMessage(
          chatId,
          `✅ <b>Аккаунт уже привязан!</b>\n\n` +
          `Сотрудник: ${name}\n` +
          `Email: ${existingEmployee.email}\n\n` +
          `Вы будете получать уведомления от системы Энергомониторинг.`
        );
        return new Response("OK", { status: 200 });
      }

      // Генерируем 6-значный код
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Срок действия - 1 час
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      // Сохраняем код в базе (employee_id = NULL, tg_id = userId)
      const { error: insertError } = await supabase
        .from("telegram_link_tokens")
        .insert([
          {
            employee_id: null,
            tg_id: String(userId),
            token: code,
            expires_at: expiresAt.toISOString(),
            used: false,
          },
        ]);

      if (insertError) {
        console.error("Failed to create code:", insertError);
        await sendTelegramMessage(
          chatId,
          "❌ Ошибка при генерации кода.\n\nПопробуйте позже или используйте привязку через веб-приложение."
        );
        return new Response("OK", { status: 200 });
      }

      await sendTelegramMessage(
        chatId,
        `👋 Привет! Это бот системы <b>Энергомониторинг</b>.\n\n` +
        `🔑 <b>Ваш код для привязки:</b>\n\n` +
        `<code>${code}</code>\n\n` +
        `<b>Как привязать аккаунт:</b>\n` +
        `1. Откройте веб-приложение Энергомониторинг\n` +
        `2. Войдите с вашим email и паролем\n` +
        `3. Введите этот код на экране привязки\n\n` +
        `⏰ Код действителен <b>1 час</b>\n\n` +
        `<i>Также вы можете использовать привязку через кнопку в приложении (старый способ)</i>`
      );
      return new Response("OK", { status: 200 });
    }

    // Обработка команды /help
    if (text === "/help") {
      await sendTelegramMessage(
        chatId,
        "📖 <b>Доступные команды:</b>\n\n" +
        "/start - Начать работу с ботом\n" +
        "/help - Показать эту справку\n" +
        "/status - Проверить статус привязки\n\n" +
        "Для привязки аккаунта используйте ссылку из веб-приложения."
      );
      return new Response("OK", { status: 200 });
    }

    // Обработка команды /status
    if (text === "/status") {
      const { data: employee } = await supabase
        .from("employees")
        .select("*")
        .eq("tg_id", String(userId))
        .single();

      if (employee) {
        const name = employee.first_name 
          ? `${employee.first_name} ${employee.last_name || ""}`.trim()
          : "Не указано";
        
        await sendTelegramMessage(
          chatId,
          `✅ <b>Аккаунт привязан</b>\n\n` +
          `Сотрудник: ${name}\n` +
          `Email: ${employee.email}\n` +
          `Статус: ${employee.is_active ? "Активен" : "Неактивен"}`
        );
      } else {
        await sendTelegramMessage(
          chatId,
          "❌ Аккаунт не привязан.\n\n" +
          "Для привязки перейдите в веб-приложение → раздел «Telegram»."
        );
      }
      return new Response("OK", { status: 200 });
    }

    // Неизвестная команда
    await sendTelegramMessage(
      chatId,
      "❓ Неизвестная команда.\n\nИспользуйте /help для списка доступных команд."
    );

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});
