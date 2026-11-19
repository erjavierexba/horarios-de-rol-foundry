const MODULE_ID = "horarios-de-rol";
const FLAG_KEY = "availability";
// URL del Worker desplegado (se puede cambiar en los ajustes del módulo).
const DEFAULT_SERVER = "https://horarios-de-rol.horarios-de-rol-web.workers.dev";
const REFRESH_MS = 60000;

const DAYS = [
  ["monday", "Lunes"],
  ["tuesday", "Martes"],
  ["wednesday", "Miércoles"],
  ["thursday", "Jueves"],
  ["friday", "Viernes"],
  ["saturday", "Sábado"],
  ["sunday", "Domingo"]
];

const SLOTS = [
  ["morning", "Mañana", "fa-sun"],
  ["afternoon", "Tarde", "fa-cloud-sun"],
  ["night", "Noche", "fa-moon"]
];

// ---------- Fechas ----------

function startOfWeek(value = new Date()) {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function dateKey(value) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function weekKey(value) {
  return dateKey(startOfWeek(value));
}

function weekNumber(value) {
  const date = startOfWeek(value);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(utc.getUTCFullYear(), 0, 4));
  return 1 + Math.round((utc - firstThursday) / 604800000);
}

function formatWeekRange(value) {
  const start = startOfWeek(value);
  const end = addDays(start, 6);
  const startMonth = start.toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
  const endMonth = end.toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()} ${startMonth} ${start.getFullYear()} — ${end.getDate()} ${endMonth} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()} ${startMonth} — ${end.getDate()} ${endMonth} ${end.getFullYear()}`;
  }
  return `${start.getDate()} — ${end.getDate()} ${endMonth} ${end.getFullYear()}`;
}

function dateTimeLocalValue(value) {
  const date = new Date(value.getTime() - (value.getTimezoneOffset() * 60000));
  return date.toISOString().slice(0, 16);
}

// ---------- Servidor ----------

function serverUrl() {
  return String(game.settings.get(MODULE_ID, "serverUrl") || DEFAULT_SERVER).trim().replace(/\/+$/, "");
}

function groupId() {
  return String(game.settings.get(MODULE_ID, "groupId") ?? "").trim();
}

function webLink(userId = "") {
  const url = new URL(serverUrl());
  url.searchParams.set("g", groupId());
  if (userId) url.searchParams.set("u", userId);
  return url.toString();
}

async function api(path, options = {}) {
  const response = await fetch(`${serverUrl()}/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error ?? `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function userColor(user) {
  const color = user.color?.css ?? user.color?.toString?.() ?? user.color;
  return /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : "#6c8cff";
}

function groupPayload() {
  return {
    name: game.world.title,
    system: game.system.title,
    users: game.users.map((user) => ({ id: user.id, name: user.name, color: userColor(user), isGM: user.isGM }))
  };
}

function isPrimaryGM() {
  if (!game.user.isGM) return false;
  const activeGM = game.users.activeGM;
  return activeGM ? activeGM.isSelf : true;
}

// Las versiones 1.x guardaban la disponibilidad en banderas del usuario. Se suben al crear el horario.
function legacyWeeks(user) {
  const value = user.getFlag(MODULE_ID, FLAG_KEY);
  if (!value || typeof value !== "object") return {};
  if (value.weeks && typeof value.weeks === "object") {
    return Object.fromEntries(Object.entries(value.weeks).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)));
  }
  if (DAYS.some(([key]) => value[key])) return { [weekKey(new Date())]: value };
  return {};
}

async function migrateLegacyFlags() {
  let migrated = 0;
  for (const user of game.users) {
    const weeks = legacyWeeks(user);
    if (!Object.keys(weeks).length) continue;
    try {
      await api(`/groups/${groupId()}/availability`, {
        method: "POST",
        body: JSON.stringify({ userId: user.id, weeks })
      });
      migrated += 1;
    } catch (error) {
      console.warn(`${MODULE_ID} | No se pudo migrar el horario de ${user.name}`, error);
    }
  }
  return migrated;
}

async function createGroup() {
  if (!game.user.isGM) return;
  if (groupId()) {
    const confirmed = await Dialog.confirm({
      title: "Crear un horario nuevo",
      content: "<p>Este mundo ya tiene un horario. Si creas otro, el enlace antiguo dejará de usarse y empezaréis de cero. ¿Seguir?</p>"
    });
    if (!confirmed) return;
  }
  try {
    const { groupId: id, adminKey } = await api("/groups", { method: "POST", body: JSON.stringify(groupPayload()) });
    await game.settings.set(MODULE_ID, "groupId", id);
    await game.settings.set(MODULE_ID, "adminKey", adminKey);
    const migrated = await migrateLegacyFlags();
    ui.notifications.info(migrated
      ? `Horario creado. Se ha subido la disponibilidad guardada de ${migrated} usuario(s).`
      : "Horario creado. Comparte el enlace con el grupo.");
  } catch (error) {
    ui.notifications.error(`No se ha podido crear el horario: ${error.message}`);
  }
  scheduleApp?.reset();
}

async function pushGroup({ silent = false } = {}) {
  if (!game.user.isGM || !groupId()) return false;
  try {
    await api(`/groups/${groupId()}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${game.settings.get(MODULE_ID, "adminKey")}` },
      body: JSON.stringify(groupPayload())
    });
    if (!silent) ui.notifications.info("Grupo sincronizado con la web.");
    return true;
  } catch (error) {
    const reason = error.status === 404
      ? "el horario ya no existe en el servidor; crea uno nuevo."
      : error.message;
    ui.notifications.warn(`Horarios de rol: no se ha podido sincronizar (${reason})`);
    return false;
  }
}

const schedulePush = foundry.utils.debounce(() => {
  if (isPrimaryGM()) pushGroup({ silent: true });
}, 2000);

// ---------- Próxima sesión ----------

async function openNextSessionEditor(dayKey, slotKey) {
  if (!game.user.isGM) return;
  const hours = { morning: 10, afternoon: 17, night: 21 };
  const date = new Date(`${dayKey}T12:00:00`);
  date.setHours(hours[slotKey] ?? 20, 0, 0, 0);

  let app;
  const WorldConfigV2 = foundry.applications?.sidebar?.apps?.WorldConfig;
  if (WorldConfigV2) {
    app = new WorldConfigV2({ world: game.world });
    await app.render({ force: true });
  } else if (globalThis.WorldConfig) {
    app = new globalThis.WorldConfig(game.world);
    app.render(true);
  } else {
    ui.notifications.error("No se ha podido abrir la configuración de la próxima sesión.");
    return;
  }

  await new Promise((resolve) => requestAnimationFrame(resolve));
  const root = app.element instanceof HTMLElement ? app.element : app.element?.[0];
  const input = root?.querySelector('input[name="nextSession"]') ?? app.form?.elements?.nextSession;
  if (!input) {
    ui.notifications.warn("Abre el campo Próxima sesión en la configuración del mundo.");
    return;
  }
  input.value = dateTimeLocalValue(date);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.focus();
  ui.notifications.info("Revisa la hora y guarda la configuración para programar la sesión.");
}

async function copyText(text) {
  try {
    if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
    else await navigator.clipboard.writeText(text);
    ui.notifications.info("Enlace copiado.");
  } catch {
    new Dialog({
      title: "Enlace del horario",
      content: `<p>Copia este enlace y pásaselo al grupo:</p><input type="text" readonly value="${foundry.utils.escapeHTML?.(text) ?? text}" style="width:100%" onfocus="this.select()">`,
      buttons: { ok: { label: "Cerrar" } }
    }).render(true);
  }
}

// ---------- Visor ----------

class RoleScheduleApp extends Application {
  constructor(...args) {
    super(...args);
    this.weekStart = startOfWeek(new Date());
    this.reset();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "role-schedule",
      title: "Horarios de rol",
      template: `modules/${MODULE_ID}/templates/schedule.hbs`,
      classes: ["horarios-de-rol", "sheet"],
      width: 560,
      height: "auto",
      resizable: true
    });
  }

  reset() {
    this.group = null;
    this.weeks = {};
    if (this.rendered) this.render(false);
  }

  // Devuelve copias locales: un reset() mientras se espera al servidor no debe romper este render.
  async load(week) {
    const id = groupId();
    let group = this.group;
    try {
      if (!group) {
        group = (await api(`/groups/${id}`)).group;
        if (id === groupId()) this.group = group;
      }
      let schedules = this.weeks[week];
      if (!schedules) {
        schedules = (await api(`/groups/${id}/weeks/${week}`)).schedules;
        if (id === groupId()) this.weeks[week] = schedules;
      }
      return { group, schedules };
    } catch (error) {
      return {
        error: error.status === 404 && !group
          ? "El horario de este mundo ya no existe en el servidor."
          : `No se ha podido conectar con el servidor de horarios (${error.message}).`
      };
    }
  }

  async getData() {
    const base = { isGM: game.user.isGM, configured: Boolean(groupId()), serverUrl: serverUrl() };
    if (!base.configured) return base;

    const selectedWeek = weekKey(this.weekStart);
    const weekStart = this.weekStart;
    const { group, schedules = {}, error } = await this.load(selectedWeek);
    const week = {
      weekNumber: weekNumber(weekStart),
      weekRange: formatWeekRange(weekStart),
      isCurrentWeek: selectedWeek === weekKey(new Date())
    };
    if (error) return { ...base, ...week, error, groupId: groupId() };

    const users = group.users
      .filter((user) => schedules[user.id])
      .map((user) => ({ ...user, schedule: schedules[user.id] }));

    const overview = DAYS.map(([key, label], index) => {
      const date = addDays(weekStart, index);
      return {
        key,
        label,
        dateKey: dateKey(date),
        dateLabel: date.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", ""),
        slots: SLOTS.map(([slotKey, slotLabel, icon]) => ({
          key: slotKey,
          label: slotLabel,
          icon,
          users: users.filter((user) => user.schedule[key]?.[slotKey])
        })),
        notes: users
          .filter((user) => user.schedule[key]?.note)
          .map((user) => ({ name: user.name, color: user.color, text: user.schedule[key].note }))
      };
    });
    const bestCount = Math.max(0, ...overview.flatMap((day) => day.slots.map((slot) => slot.users.length)));
    for (const day of overview) {
      for (const slot of day.slots) slot.isBest = bestCount > 0 && slot.users.length === bestCount;
    }
    const missing = group.users.filter((user) => !user.isGM && !schedules[user.id]).map((user) => user.name);

    return {
      ...base,
      ...week,
      groupId: groupId(),
      groupName: group.name,
      groupSystem: group.system,
      canSchedule: game.user.isGM,
      bestCount,
      missing: missing.join(", "),
      overview
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-week-shift]").on("click", (event) => {
      this.weekStart = addDays(this.weekStart, Number(event.currentTarget.dataset.weekShift) * 7);
      this.render(false);
    });
    html.find("[data-action='current-week']").on("click", () => {
      this.weekStart = startOfWeek(new Date());
      this.render(false);
    });
    html.find("[data-action='create-group']").on("click", () => createGroup());
    html.find("[data-action='open-web']").on("click", () => window.open(webLink(game.user.id), "_blank", "noopener"));
    html.find("[data-action='copy-link']").on("click", () => copyText(webLink()));
    html.find("[data-action='sync']").on("click", async () => {
      if (game.user.isGM) await pushGroup();
      this.reset();
    });
    html.find("[data-action='schedule-session']").on("click", async (event) => {
      await openNextSessionEditor(event.currentTarget.dataset.date, event.currentTarget.dataset.slot);
    });
    html.find("[data-action='schedule-session']").on("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.currentTarget.click();
    });

    this.refreshTimer ??= setInterval(() => {
      if (!this.rendered || !groupId()) return;
      delete this.weeks[weekKey(this.weekStart)];
      this.render(false);
    }, REFRESH_MS);
  }

  async close(options) {
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    return super.close(options);
  }
}

let scheduleApp;

function openSchedule() {
  scheduleApp ??= new RoleScheduleApp();
  // Al abrir se pide siempre la semana fresca.
  scheduleApp.weeks = {};
  scheduleApp.render(true);
}

function addScheduleSceneControl(controls) {
  const title = "Horarios de rol";
  const icon = "fas fa-calendar-check";

  // Foundry v12 entrega un array; v13 usa un registro indexado por nombre.
  if (Array.isArray(controls)) {
    const control = {
      name: "roleSchedule",
      title,
      icon,
      layer: "controls",
      tools: [{
        name: "openRoleSchedule",
        title: "Abrir horarios de rol",
        icon,
        button: true,
        onClick: openSchedule
      }]
    };
    const notesIndex = controls.findIndex((entry) => entry.name === "notes");
    controls.splice(notesIndex >= 0 ? notesIndex + 1 : controls.length, 0, control);
    return;
  }

  const notesOrder = Number(controls.notes?.order);
  const lastOrder = Math.max(0, ...Object.values(controls).map((control) => Number(control.order) || 0));
  controls.roleSchedule = {
    name: "roleSchedule",
    title,
    icon,
    order: Number.isFinite(notesOrder) ? notesOrder + 1 : lastOrder + 1,
    visible: true,
    activeTool: "openRoleSchedule",
    tools: {
      openRoleSchedule: {
        name: "openRoleSchedule",
        title: "Abrir horarios de rol",
        icon,
        order: 0,
        button: true,
        visible: true,
        onChange: openSchedule
      }
    },
    onChange: (_event, active) => {
      if (active) openSchedule();
    }
  };
}

function rootElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "serverUrl", {
    name: "Servidor de horarios",
    hint: "Dirección de la web de horarios (el Worker de Cloudflare).",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_SERVER,
    onChange: () => scheduleApp?.reset()
  });
  game.settings.register(MODULE_ID, "groupId", {
    scope: "world",
    config: false,
    type: String,
    default: "",
    onChange: () => scheduleApp?.reset()
  });
  game.settings.register(MODULE_ID, "adminKey", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.settings.registerMenu(MODULE_ID, "openSchedule", {
    name: "Abrir horarios de rol",
    label: "Abrir horario",
    hint: "Consulta la disponibilidad del grupo y abre la web para rellenar la tuya.",
    icon: "fas fa-calendar-days",
    type: RoleScheduleApp,
    restricted: false
  });
});

Hooks.on("getSceneControlButtons", addScheduleSceneControl);

Hooks.on("renderPlayerList", (_app, html) => {
  const root = rootElement(html);
  if (!root || root.querySelector(".role-schedule-open")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "role-schedule-open";
  button.innerHTML = '<i class="fas fa-calendar-days"></i> Horarios de rol';
  button.addEventListener("click", openSchedule);
  const header = root.querySelector(".directory-header") ?? root;
  header.append(button);
});

// Si cambia la lista de usuarios, la web se entera.
Hooks.on("createUser", schedulePush);
Hooks.on("deleteUser", schedulePush);
Hooks.on("updateUser", (_user, changes) => {
  if ("name" in changes || "color" in changes || "role" in changes) schedulePush();
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { open: openSchedule, sync: () => pushGroup(), link: () => webLink() };
  // Al arrancar el mundo, el máster envía nombre, sistema y usuarios al grupo.
  if (groupId() && isPrimaryGM()) pushGroup({ silent: true });
});
