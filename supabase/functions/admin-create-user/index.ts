// Edge Function: создание пользователя (только для владельца)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "8" || digits[0] === "7")) {
    return "+7" + digits.slice(1);
  }
  if (digits.length === 10 && digits[0] !== "0") {
    return "+7" + digits;
  }
  return null;
}

interface CreateUserBody {
  email: string;
  password: string;
  first_name: string;
  last_name?: string;
  role: "owner" | "user";
  object_ids?: number[];
  max_id?: string;
  phone?: string;
  notify_via_email?: boolean;
  notify_via_telegram?: boolean;
  notify_via_max?: boolean;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Требуется авторизация" }, 401);
  }

  const token = authHeader.slice(7);
  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !caller) {
    return jsonResponse({ error: "Неверный или истёкший токен" }, 401);
  }

  // Ищем сотрудника по email (надёжнее, чем по auth_user_id)
  const { data: callerEmployee, error: empError } = await supabaseAdmin
    .from("employees")
    .select("id, role")
    .eq("email", caller.email)
    .eq("is_active", true)
    .maybeSingle();

  if (empError || !callerEmployee || callerEmployee.role !== "owner") {
    return jsonResponse({ error: "Доступ только у владельца" }, 403);
  }

  let body: CreateUserBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Некорректный JSON" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const first_name = typeof body.first_name === "string" ? body.first_name.trim() : "";
  const last_name = typeof body.last_name === "string" ? body.last_name.trim() : null;
  const role = body.role === "owner" || body.role === "user" ? body.role : "user";
  const object_ids = Array.isArray(body.object_ids) ? body.object_ids.filter((id: unknown) => typeof id === "number") : [];
  const max_id = typeof body.max_id === "string" ? body.max_id.trim() || null : null;
  const phoneRaw = typeof body.phone === "string" ? body.phone.trim() || null : null;
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const notify_via_email = body.notify_via_email === true;
  const notify_via_telegram = body.notify_via_telegram === true;
  const notify_via_max = body.notify_via_max === true;

  if (!email || !password || !first_name) {
    return jsonResponse({ error: "Укажите email, пароль и имя" }, 400);
  }

  if (password.length < 6) {
    return jsonResponse({ error: "Пароль не менее 6 символов" }, 400);
  }

  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    return jsonResponse({ error: createError.message || "Ошибка создания пользователя" }, 400);
  }

  if (!newUser.user) {
    return jsonResponse({ error: "Пользователь не создан" }, 500);
  }

  const { data: newEmployee, error: insertError } = await supabaseAdmin
    .from("employees")
    .insert({
      auth_user_id: newUser.user.id,
      email,
      first_name,
      last_name: last_name || null,
      role,
      is_active: true,
      max_id: max_id ?? null,
      phone: phone ?? null,
      notify_via_email,
      notify_via_telegram,
      notify_via_max,
    })
    .select("id")
    .single();

  if (insertError || !newEmployee) {
    await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
    return jsonResponse({ error: "Ошибка создания записи сотрудника: " + (insertError?.message || "unknown") }, 500);
  }

  if (object_ids.length > 0 && newEmployee.id) {
    await supabaseAdmin
      .from("objects")
      .update({ assigned_employee_id: newEmployee.id })
      .in("id", object_ids);
  }

  return jsonResponse({ success: true, message: "Пользователь создан. Передайте ему логин (email) и пароль для входа." });
});
