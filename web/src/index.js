const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const SLOTS = ["morning", "afternoon", "night"];
const GROUP_ID = /^[A-Za-z0-9]{12,40}$/;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WEEK = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 256 * 1024;
const MAX_USERS = 100;
const MAX_WEEKS_PER_POST = 200;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS }
  });
}

function randomId(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeColor(value) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#6c8cff";
}

function normalizeUsers(value) {
  if (!Array.isArray(value)) throw new HttpError(400, "Falta la lista de usuarios.");
  const seen = new Set();
  const users = [];
  for (const user of value.slice(0, MAX_USERS)) {
    const id = String(user?.id ?? "");
    if (!USER_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    users.push({
      id,
      name: text(user.name, 80) || "Sin nombre",
      color: normalizeColor(user.color),
      isGM: Boolean(user.isGM)
    });
  }
  return users;
}

function normalizeSchedule(value = {}) {
  return Object.fromEntries(DAYS.map((key) => {
    const day = value?.[key] ?? {};
    return [key, {
      ...Object.fromEntries(SLOTS.map((slot) => [slot, Boolean(day[slot])])),
      note: text(day.note, 240)
    }];
  }));
}

function isEmpty(schedule) {
  return DAYS.every((key) => !schedule[key].note && SLOTS.every((slot) => !schedule[key][slot]));
}

async function readJson(request) {
  const body = await request.text();
  if (body.length > MAX_BODY) throw new HttpError(413, "La petición es demasiado grande.");
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new HttpError(400, "El cuerpo no es JSON válido.");
  }
}

async function findGroup(db, groupId) {
  if (!GROUP_ID.test(groupId)) throw new HttpError(404, "Ese horario no existe.");
  const group = await db.prepare("SELECT * FROM schedule_groups WHERE id = ?").bind(groupId).first();
  if (!group) throw new HttpError(404, "Ese horario no existe.");
  return group;
}

function userStatements(db, groupId, users) {
  return [
    db.prepare("DELETE FROM group_users WHERE group_id = ?").bind(groupId),
    ...users.map((user, index) => db
      .prepare("INSERT INTO group_users (group_id, id, name, color, is_gm, sort) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(groupId, user.id, user.name, user.color, user.isGM ? 1 : 0, index))
  ];
}

async function groupView(db, group) {
  const { results } = await db
    .prepare("SELECT id, name, color, is_gm FROM group_users WHERE group_id = ? ORDER BY sort")
    .bind(group.id)
    .all();
  return {
    id: group.id,
    name: group.name,
    system: group.system,
    updatedAt: group.updated_at,
    users: results.map((user) => ({ id: user.id, name: user.name, color: user.color, isGM: Boolean(user.is_gm) }))
  };
}

async function createGroup(request, env) {
  const body = await readJson(request);
  const users = normalizeUsers(body.users);
  const now = Date.now();
  const group = {
    id: randomId(16),
    admin_key: randomId(32),
    name: text(body.name, 120) || "Grupo de rol",
    system: text(body.system, 120),
    created_at: now,
    updated_at: now
  };
  await env.DB.batch([
    env.DB
      .prepare("INSERT INTO schedule_groups (id, admin_key, name, system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(group.id, group.admin_key, group.name, group.system, group.created_at, group.updated_at),
    ...userStatements(env.DB, group.id, users)
  ]);
  return json({ groupId: group.id, adminKey: group.admin_key, group: await groupView(env.DB, group) }, 201);
}

async function updateGroup(request, env, groupId) {
  const group = await findGroup(env.DB, groupId);
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token !== group.admin_key) throw new HttpError(403, "La clave del máster no es válida.");
  const body = await readJson(request);
  const users = normalizeUsers(body.users);
  group.name = text(body.name, 120) || group.name;
  group.system = text(body.system, 120);
  group.updated_at = Date.now();
  await env.DB.batch([
    env.DB
      .prepare("UPDATE schedule_groups SET name = ?, system = ?, updated_at = ? WHERE id = ?")
      .bind(group.name, group.system, group.updated_at, group.id),
    ...userStatements(env.DB, group.id, users)
  ]);
  return json({ group: await groupView(env.DB, group) });
}

async function getWeek(env, groupId, week) {
  if (!WEEK.test(week)) throw new HttpError(400, "Semana no válida.");
  await findGroup(env.DB, groupId);
  const { results } = await env.DB
    .prepare(`SELECT a.user_id, a.data, a.updated_at FROM availability a
              JOIN group_users u ON u.group_id = a.group_id AND u.id = a.user_id
              WHERE a.group_id = ? AND a.week = ?`)
    .bind(groupId, week)
    .all();
  const schedules = {};
  const updatedAt = {};
  for (const row of results) {
    schedules[row.user_id] = normalizeSchedule(JSON.parse(row.data));
    updatedAt[row.user_id] = row.updated_at;
  }
  return json({ week, schedules, updatedAt });
}

async function postAvailability(request, env, groupId) {
  await findGroup(env.DB, groupId);
  const body = await readJson(request);
  const userId = String(body.userId ?? "");
  const member = USER_ID.test(userId) && await env.DB
    .prepare("SELECT id FROM group_users WHERE group_id = ? AND id = ?")
    .bind(groupId, userId)
    .first();
  if (!member) throw new HttpError(404, "Ese usuario no está en el grupo.");

  const weeks = Object.entries(body.weeks ?? {}).filter(([week]) => WEEK.test(week));
  if (!weeks.length) throw new HttpError(400, "No hay ninguna semana que guardar.");
  if (weeks.length > MAX_WEEKS_PER_POST) throw new HttpError(413, "Demasiadas semanas en una sola petición.");

  const now = Date.now();
  await env.DB.batch(weeks.map(([week, value]) => {
    const schedule = normalizeSchedule(value);
    if (isEmpty(schedule)) {
      return env.DB
        .prepare("DELETE FROM availability WHERE group_id = ? AND user_id = ? AND week = ?")
        .bind(groupId, userId, week);
    }
    return env.DB
      .prepare(`INSERT INTO availability (group_id, user_id, week, data, updated_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (group_id, user_id, week) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .bind(groupId, userId, week, JSON.stringify(schedule), now);
  }));
  return json({ ok: true, weeks: weeks.map(([week]) => week), updatedAt: now });
}

async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean).slice(1);
  const method = request.method;

  if (parts[0] !== "groups") throw new HttpError(404, "Ruta no encontrada.");
  if (parts.length === 1 && method === "POST") return createGroup(request, env);

  const groupId = parts[1] ?? "";
  if (parts.length === 2 && method === "GET") return json({ group: await groupView(env.DB, await findGroup(env.DB, groupId)) });
  if (parts.length === 2 && method === "PUT") return updateGroup(request, env, groupId);
  if (parts.length === 4 && parts[2] === "weeks" && method === "GET") return getWeek(env, groupId, parts[3]);
  if (parts.length === 3 && parts[2] === "availability" && method === "POST") return postAvailability(request, env, groupId);
  throw new HttpError(404, "Ruta no encontrada.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "Error interno del servidor." }, 500);
    }
  }
};
