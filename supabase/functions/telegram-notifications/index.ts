// Supabase Edge Function для ежедневных уведомлений в Telegram
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = "8477674658:AAHdZS8bGIKINlXawLoNJiuukywWQgAt3E0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Employee {
  id: number;
  tg_id: string;
  first_name: string;
  last_name: string;
}

interface Object {
  id: number;
  object_name: string;
  object_address: string;
}

interface Counter {
  id: number;
  object_id: number;
  counter_type: string;
}

async function sendTelegramMessage(chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
      }),
    });
    
    const result = await response.json();
    if (!result.ok) {
      console.error("Telegram API error:", result);
    }
    return result.ok;
  } catch (error) {
    console.error("Error sending message to", chatId, error);
    return false;
  }
}

function getMoscowDate(): Date {
  const now = new Date();
  // Moscow is UTC+3
  const moscowOffset = 3 * 60; // minutes
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const moscowTime = new Date(utcTime + (moscowOffset * 60000));
  return moscowTime;
}

serve(async (req: Request) => {
  try {
    console.log("Starting notification check...");

    // Проверяем, что сегодня >= 19 числа
    const moscowNow = getMoscowDate();
    const dayOfMonth = moscowNow.getDate();
    
    console.log("Moscow time:", moscowNow.toISOString(), "Day:", dayOfMonth);

    if (dayOfMonth < 19) {
      console.log("Day is less than 19, skipping notifications");
      return new Response(JSON.stringify({ message: "Not notification period yet" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Получаем текущий месяц и год (МСК)
    const currentYear = moscowNow.getFullYear();
    const currentMonth = moscowNow.getMonth() + 1; // 1-12
    const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    
    // Следующий месяц для диапазона
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    console.log("Checking readings for period:", monthStart, "to", monthEnd);

    // Получаем все активные объекты
    const { data: objects, error: objectsError } = await supabase
      .from("objects")
      .select("id, object_name, object_address")
      .eq("is_active", true);

    if (objectsError || !objects) {
      console.error("Error fetching objects:", objectsError);
      return new Response(JSON.stringify({ error: "Failed to fetch objects" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("Found", objects.length, "active objects");

    // Получаем все активные счётчики
    const { data: counters, error: countersError } = await supabase
      .from("counters")
      .select("id, object_id, counter_type")
      .eq("is_active", true);

    if (countersError || !counters) {
      console.error("Error fetching counters:", countersError);
      return new Response(JSON.stringify({ error: "Failed to fetch counters" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("Found", counters.length, "active counters");

    // Получаем все показания за текущий месяц
    const { data: readings, error: readingsError } = await supabase
      .from("meter_readings")
      .select("counter_id")
      .gte("reading_date", monthStart)
      .lt("reading_date", monthEnd);

    if (readingsError) {
      console.error("Error fetching readings:", readingsError);
      return new Response(JSON.stringify({ error: "Failed to fetch readings" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const readingCounterIds = new Set((readings || []).map(r => r.counter_id));
    console.log("Found", readingCounterIds.size, "counters with readings this month");

    // Находим объекты без показаний
    const objectsWithoutData: Object[] = [];

    for (const obj of objects) {
      // Счётчики этого объекта
      const objectCounters = counters.filter(c => c.object_id === obj.id);
      
      if (objectCounters.length === 0) {
        // У объекта нет счётчиков — пропускаем
        continue;
      }

      // Проверяем, есть ли хотя бы одно показание
      const hasAnyReading = objectCounters.some(counter => 
        readingCounterIds.has(counter.id)
      );

      if (!hasAnyReading) {
        // Ни одного показания за этот месяц
        objectsWithoutData.push(obj);
      }
    }

    console.log("Objects without data:", objectsWithoutData.length);

    // Если все данные заполнены — не отправляем уведомления
    if (objectsWithoutData.length === 0) {
      console.log("All objects have data, no notifications needed");
      return new Response(JSON.stringify({ message: "All data filled, no notifications sent" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Формируем сообщение
    const monthNames = [
      "январь", "февраль", "март", "апрель", "май", "июнь",
      "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"
    ];
    const monthName = monthNames[currentMonth - 1];

    let message = `⚠️ <b>Напоминание: внесите показания счётчиков</b>\n\n`;
    message += `За <b>${monthName} ${currentYear}</b> не внесены данные по следующим объектам:\n\n`;

    objectsWithoutData.forEach((obj, index) => {
      message += `${index + 1}. <b>${obj.object_name}</b>\n`;
      message += `   ${obj.object_address}\n\n`;
    });

    message += `Пожалуйста, внесите показания счётчиков в системе Энергомониторинг.`;

    console.log("Message to send:", message);

    // Получаем всех сотрудников с привязанным Telegram
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id, tg_id, first_name, last_name")
      .eq("is_active", true)
      .not("tg_id", "is", null);

    if (employeesError || !employees) {
      console.error("Error fetching employees:", employeesError);
      return new Response(JSON.stringify({ error: "Failed to fetch employees" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("Found", employees.length, "employees with Telegram");

    // Отправляем уведомления всем
    const sendResults = await Promise.all(
      employees.map(emp => sendTelegramMessage(emp.tg_id, message))
    );

    const successCount = sendResults.filter(r => r).length;
    console.log(`Sent ${successCount}/${employees.length} notifications successfully`);

    return new Response(JSON.stringify({
      message: "Notifications sent",
      objectsWithoutData: objectsWithoutData.length,
      employeesNotified: successCount,
      totalEmployees: employees.length
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in notification function:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
