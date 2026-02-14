// Edge Function: обновление пользователя (только для владельца)
// Изменение email, пароля, имени, фамилии, роли и назначенных объектов.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface UpdateUserBody {
  employee_id: number;
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  role?: "owner" | "user";
  object_ids?: number[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Требуется авторизация" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = authHeader.slice(7);
  const {
    data: { user: caller },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);
  if (authError || !caller) {
    return new Response(JSON.stringify({ error: "Неверный или истёкший токен" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: callerEmployee, error: empError } = await supabaseAdmin
    .from("employees")
    .select("id, role")
    .eq("auth_user_id", caller.id)
    .eq("is_active", true)
    .maybeSingle();

  if (empError || !callerEmployee || callerEmployee.role !== "owner") {
    return new Response(JSON.stringify({ error: "Доступ только у владельца" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: UpdateUserBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Некорректный JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const employee_id = typeof body.employee_id === "number" ? body.employee_id : null;
  if (employee_id == null) {
    return new Response(JSON.stringify({ error: "Укажите employee_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: employee, error: fetchErr } = await supabaseAdmin
    .from("employees")
    .select("id, auth_user_id, email, first_name, last_name, role")
    .eq("id", employee_id)
    .eq("is_active", true)
    .maybeSingle();

  if (fetchErr || !employee) {
    return new Response(JSON.stringify({ error: "Сотрудник не найден" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const email = typeof body.email === "string" ? body.email.trim() : null;
  const password = typeof body.password === "string" ? body.password : null;
  const first_name = typeof body.first_name === "string" ? body.first_name.trim() : null;
  const last_name = typeof body.last_name === "string" ? body.last_name.trim() : null;
  const role = body.role === "owner" || body.role === "user" ? body.role : null;
  const object_ids = Array.isArray(body.object_ids)
    ? body.object_ids.filter((id: unknown) => typeof id === "number")
    : null;

  if (email !== null && !email) {
    return new Response(JSON.stringify({ error: "Email не может быть пустым" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (password !== null && password.length > 0 && password.length < 6) {
    return new Response(JSON.stringify({ error: "Пароль не менее 6 символов" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Обновление Auth (email и/или пароль)
  if (employee.auth_user_id) {
    if (email !== null && email !== employee.email) {
      const { error: updateEmailErr } = await supabaseAdmin.auth.admin.updateUserById(
        employee.auth_user_id,
        { email }
      );
      if (updateEmailErr) {
        return new Response(
          JSON.stringify({ error: "Ошибка смены email: " + (updateEmailErr.message || "unknown") }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }
    if (password !== null && password.length >= 6) {
      const { error: updatePwErr } = await supabaseAdmin.auth.admin.updateUserById(
        employee.auth_user_id,
        { password }
      );
      if (updatePwErr) {
        return new Response(
          JSON.stringify({ error: "Ошибка смены пароля: " + (updatePwErr.message || "unknown") }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  }

  // Обновление записи сотрудника
  const employeeUpdate: Record<string, unknown> = {};
  if (email !== null) employeeUpdate.email = email;
  if (first_name !== null) employeeUpdate.first_name = first_name;
  if (last_name !== null) employeeUpdate.last_name = last_name;
  if (role !== null) employeeUpdate.role = role;

  if (Object.keys(employeeUpdate).length > 0) {
    const { error: updateEmpErr } = await supabaseAdmin
      .from("employees")
      .update(employeeUpdate)
      .eq("id", employee_id);
    if (updateEmpErr) {
      return new Response(
        JSON.stringify({ error: "Ошибка обновления сотрудника: " + (updateEmpErr.message || "unknown") }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Назначение объектов: снять со всех, затем назначить выбранные
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

  return new Response(
    JSON.stringify({ success: true, message: "Параметры пользователя сохранены." }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});
