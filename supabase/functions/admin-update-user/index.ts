// Edge Function: обновление пользователя (только для владельца)
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

interface UpdateUserBody {
  employee_id: number;
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  role?: "owner" | "user";
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

  let body: UpdateUserBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Некорректный JSON" }, 400);
  }

  const employee_id =
    typeof body.employee_id === "number"
      ? body.employee_id
      : typeof body.employee_id === "string"
        ? parseInt(body.employee_id, 10)
        : null;
  if (employee_id == null || isNaN(employee_id)) {
    return jsonResponse({ error: "Укажите employee_id" }, 400);
  }

  const { data: employee, error: fetchErr } = await supabaseAdmin
    .from("employees")
    .select("id, email, first_name, last_name, role")
    .eq("id", employee_id)
    .eq("is_active", true)
    .maybeSingle();

  if (fetchErr || !employee) {
    return jsonResponse({ error: "Сотрудник не найден" }, 404);
  }

  const email = typeof body.email === "string" ? body.email.trim() : null;
  const password = typeof body.password === "string" ? body.password : null;
  const first_name = typeof body.first_name === "string" ? body.first_name.trim() : null;
  const last_name = typeof body.last_name === "string" ? body.last_name.trim() : null;
  const role = body.role === "owner" || body.role === "user" ? body.role : null;
  const object_ids = Array.isArray(body.object_ids)
    ? body.object_ids.filter((id: unknown) => typeof id === "number")
    : null;
  const max_id = Object.prototype.hasOwnProperty.call(body, "max_id")
    ? (typeof body.max_id === "string" ? (body.max_id.trim() || null) : null)
    : undefined;
  const phoneRaw = Object.prototype.hasOwnProperty.call(body, "phone")
    ? (typeof body.phone === "string" ? body.phone.trim() : null)
    : undefined;
  const phone = phoneRaw !== undefined
    ? (phoneRaw ? normalizePhone(phoneRaw) : null)
    : undefined;

  if (email !== null && !email) {
    return jsonResponse({ error: "Email не может быть пустым" }, 400);
  }
  if (password !== null && password.length > 0 && password.length < 6) {
    return jsonResponse({ error: "Пароль не менее 6 символов" }, 400);
  }

  // Обновление пароля через Auth (по email, без учёта регистра)
  if (password !== null && password.length >= 6) {
    const { data: authUser } = await supabaseAdmin.auth.admin.listUsers();
    const targetAuthUser = authUser?.users?.find(
      (u) => u.email?.toLowerCase() === employee.email?.toLowerCase()
    );
    if (targetAuthUser) {
      const updatePayload: { password?: string; email?: string } = { password };
      if (email !== null && email !== employee.email) updatePayload.email = email;
      const { error: updatePwErr } = await supabaseAdmin.auth.admin.updateUserById(
        targetAuthUser.id,
        updatePayload
      );
      if (updatePwErr) {
        return jsonResponse({ error: "Ошибка смены пароля: " + (updatePwErr.message || "unknown") }, 400);
      }
    }
  } else if (email !== null && email !== employee.email) {
    const { data: authUser } = await supabaseAdmin.auth.admin.listUsers();
    const targetAuthUser = authUser?.users?.find(
      (u) => u.email?.toLowerCase() === employee.email?.toLowerCase()
    );
    if (targetAuthUser) {
      const { error: updateEmailErr } = await supabaseAdmin.auth.admin.updateUserById(
        targetAuthUser.id,
        { email }
      );
      if (updateEmailErr) {
        return jsonResponse({ error: "Ошибка смены email: " + (updateEmailErr.message || "unknown") }, 400);
      }
    }
  }

  // Обновление записи сотрудника
  const employeeUpdate: Record<string, unknown> = {};
  if (email !== null) employeeUpdate.email = email;
  if (first_name !== null) employeeUpdate.first_name = first_name;
  if (last_name !== null) employeeUpdate.last_name = last_name;
  if (role !== null) employeeUpdate.role = role;
  if (max_id !== undefined) employeeUpdate.max_id = max_id;
  if (phone !== undefined) employeeUpdate.phone = phone;
  if (body.notify_via_email !== undefined) employeeUpdate.notify_via_email = body.notify_via_email === true;
  if (body.notify_via_telegram !== undefined) employeeUpdate.notify_via_telegram = body.notify_via_telegram === true;
  if (body.notify_via_max !== undefined) employeeUpdate.notify_via_max = body.notify_via_max === true;

  if (Object.keys(employeeUpdate).length > 0) {
    const { error: updateEmpErr } = await supabaseAdmin
      .from("employees")
      .update(employeeUpdate)
      .eq("id", employee_id);
    if (updateEmpErr) {
      return jsonResponse({ error: "Ошибка обновления сотрудника: " + (updateEmpErr.message || "unknown") }, 500);
    }
  }

  // Назначение объектов
  await supabaseAdmin
    .from("objects")
    .update({ assigned_employee_id: null })
    .eq("assigned_employee_id", employee_id);

  if (object_ids !== null && object_ids.length > 0) {
    await supabaseAdmin
      .from("objects")
      .update({ assigned_employee_id: employee_id })
      .in("id", object_ids);
  }

  return jsonResponse({ success: true, message: "Параметры пользователя сохранены." });
});
