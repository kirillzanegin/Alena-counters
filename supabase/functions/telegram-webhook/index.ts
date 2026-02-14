// Supabase Edge Function для обработки Telegram webhook
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = "8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
// URL мини‑приложения (лендинга), задаётся в переменных окружения Supabase
const WEBAPP_URL = Deno.env.get("WEBAPP_URL") as string | undefined;

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

interface TelegramReplyMarkup {
  inline_keyboard?: Array<
    Array<{
      text: string;
      url?: string;
      web_app?: { url: string };
    }>
  >;
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: TelegramReplyMarkup
) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
      
      console.log("🔍 Received token:", token);
      
      if (!token) {
        await sendTelegramMessage(
          chatId,
          "❌ Некорректный токен привязки.\n\nПолучите новый токен в веб-приложении."
        );
        return new Response("OK", { status: 200 });
      }

      // Ищем токен в employees
      const { data: employee, error: tokenError } = await supabase
        .from("employees")
        .select("*")
        .eq("link_token", token)
        .eq("is_active", true)
        .maybeSingle();

      console.log("🔍 Database search result:", { employee, tokenError });

      if (tokenError || !employee) {
        console.error("❌ Token not found or error:", tokenError);
        
        // Проверим, есть ли вообще токены в базе
        const { data: allEmployeesWithTokens } = await supabase
          .from("employees")
          .select("id, email, link_token, link_expires_at")
          .not("link_token", "is", null);
        
        console.log("📋 All employees with tokens:", allEmployeesWithTokens);
        
        await sendTelegramMessage(
          chatId,
          "❌ Токен не найден или недействителен.\n\n" +
          `Полученный токен: <code>${token}</code>\n\n` +
          "Получите новый токен в веб-приложении."
        );
        return new Response("OK", { status: 200 });
      }

      // Проверяем срок действия токена
      if (employee.link_expires_at) {
        const expiresAt = new Date(employee.link_expires_at);
        const now = new Date();
        
        if (now > expiresAt) {
          await sendTelegramMessage(
            chatId,
            "⏰ Токен истёк.\n\nПолучите новый токен в веб-приложении."
          );
          return new Response("OK", { status: 200 });
        }
      }

      // Проверяем, не привязан ли уже другой Telegram к этому сотруднику
      if (employee.tg_id && employee.tg_id !== String(userId)) {
        await sendTelegramMessage(
          chatId,
          "⚠️ К этому аккаунту уже привязан другой Telegram.\n\nСначала отвяжите старый аккаунт в веб-приложении."
        );
        return new Response("OK", { status: 200 });
      }

      // Привязываем Telegram ID к сотруднику и очищаем токен
      const { error: updateError } = await supabase
        .from("employees")
        .update({ tg_id: String(userId), link_token: null, link_expires_at: null })
        .eq("id", employee.id);

      if (updateError) {
        console.error("Failed to update employee:", updateError);
        await sendTelegramMessage(
          chatId,
          "❌ Ошибка при привязке аккаунта.\n\nПопробуйте позже."
        );
        return new Response("OK", { status: 200 });
      }

      // Отправляем успешное сообщение
      const employeeName = employee.first_name 
        ? `${employee.first_name} ${employee.last_name || ""}`.trim()
        : employee.email;

      await sendTelegramMessage(
        chatId,
        `✅ <b>Аккаунт успешно привязан!</b>\n\n` +
        `Сотрудник: ${employeeName}\n` +
        `Email: ${employee.email}\n\n` +
        `Теперь вы будете получать уведомления от системы Энергомониторинг.`
      );

      return new Response("OK", { status: 200 });
    }

    // Обработка команды /start без токена
    if (text === "/start") {
      if (!chatId) {
        return new Response("OK", { status: 200 });
      }

      // Проверяем, не привязан ли уже этот Telegram ID
      const { data: existingEmployee } = await supabase
        .from("employees")
        .select("*")
        .eq("tg_id", String(userId))
        .eq("is_active", true)
        .maybeSingle();

      if (existingEmployee) {
        const name = existingEmployee.first_name 
          ? `${existingEmployee.first_name} ${existingEmployee.last_name || ""}`.trim()
          : "Не указано";

        await sendTelegramMessage(
          chatId,
          `✅ <b>Ваш аккаунт уже привязан!</b>\n\n` +
          `Сотрудник: ${name}\n` +
          `Email: ${existingEmployee.email}\n\n` +
          `Откройте приложение из меню бота, чтобы начать работу.`
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `👋 Привет! Это бот системы <b>Энергомониторинг</b>.\n\n` +
          `Для привязки аккаунта:\n` +
          `1. Откройте веб-приложение\n` +
          `2. Войдите с вашим email и паролем\n` +
          `3. Перейдите в раздел «Telegram»\n` +
          `4. Нажмите «Привязать Telegram» и перейдите по ссылке\n\n` +
          `Или откройте приложение из Telegram, войдите — привязка произойдёт автоматически.`
        );
      }

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
