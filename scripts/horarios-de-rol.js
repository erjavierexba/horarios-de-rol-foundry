const MODULE_ID = "horarios-de-rol";
const FLAG_KEY = "availability";

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

function emptyDay() {
  return { morning: false, afternoon: false, night: false, note: "" };
}

function normalizeSchedule(value = {}) {
  return Object.fromEntries(DAYS.map(([key]) => {
    const day = value?.[key] ?? {};
    return [key, {
      morning: Boolean(day.morning),
      afternoon: Boolean(day.afternoon),
      night: Boolean(day.night),
      note: String(day.note ?? "").trim().slice(0, 240)
    }];
  }));
}

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

function weekKey(value) {
  const date = startOfWeek(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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

function normalizeAvailability(value = {}) {
  const weeks = {};
  if (value?.weeks && typeof value.weeks === "object") {
    for (const [key, schedule] of Object.entries(value.weeks)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) weeks[key] = normalizeSchedule(schedule);
    }
  }
  return { version: 2, weeks };
}

function scheduleForWeek(value, key) {
  if (value?.weeks && typeof value.weeks === "object") return normalizeSchedule(value.weeks[key]);
  // La versión 1 guardaba una única semana recurrente. Se conserva como la semana actual.
  if (value && key === weekKey(new Date()) && DAYS.some(([dayKey]) => value[dayKey])) {
    return normalizeSchedule(value);
  }
  return normalizeSchedule();
}

class RoleScheduleApp extends FormApplication {
  constructor(...args) {
    super(...args);
    this.weekStart = startOfWeek(new Date());
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "role-schedule",
      title: "Horarios de rol",
      template: `modules/${MODULE_ID}/templates/schedule.hbs`,
      classes: ["horarios-de-rol", "sheet"],
      width: 960,
      height: "auto",
      resizable: true,
      closeOnSubmit: false,
      submitOnChange: false
    });
  }

  getData(options = {}) {
    const context = super.getData(options);
    const selectedWeek = weekKey(this.weekStart);
    const mine = scheduleForWeek(game.user.getFlag(MODULE_ID, FLAG_KEY), selectedWeek);
    const users = game.users
      .filter((user) => !user.isGM || user.active || user.getFlag(MODULE_ID, FLAG_KEY))
      .map((user) => ({
        id: user.id,
        name: user.name,
        color: user.color?.css ?? user.color ?? "#6c8cff",
        schedule: scheduleForWeek(user.getFlag(MODULE_ID, FLAG_KEY), selectedWeek)
      }));

    return {
      ...context,
      userName: game.user.name,
      weekKey: selectedWeek,
      weekNumber: weekNumber(this.weekStart),
      weekRange: formatWeekRange(this.weekStart),
      isCurrentWeek: selectedWeek === weekKey(new Date()),
      days: DAYS.map(([key, label], index) => ({
        key,
        label,
        dateLabel: addDays(this.weekStart, index)
          .toLocaleDateString("es-ES", { day: "numeric", month: "short" })
          .replace(".", ""),
        note: mine[key].note,
        slots: SLOTS.map(([slotKey, slotLabel, icon]) => ({
          key: slotKey,
          label: slotLabel,
          icon,
          checked: mine[key][slotKey]
        }))
      })),
      overview: DAYS.map(([key, label], index) => ({
        key,
        label,
        dateLabel: addDays(this.weekStart, index)
          .toLocaleDateString("es-ES", { day: "numeric", month: "short" })
          .replace(".", ""),
        slots: SLOTS.map(([slotKey, slotLabel, icon]) => ({
          key: slotKey,
          label: slotLabel,
          icon,
          users: users.filter((user) => user.schedule[key][slotKey])
        })),
        notes: users
          .filter((user) => user.schedule[key].note)
          .map((user) => ({ name: user.name, color: user.color, text: user.schedule[key].note }))
      }))
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
    html.find("[data-action='clear']").on("click", async () => {
      const confirmed = await Dialog.confirm({
        title: "Borrar esta semana",
        content: `<p>¿Quieres borrar tu disponibilidad y tus notas de la semana <strong>${formatWeekRange(this.weekStart)}</strong>?</p>`
      });
      if (!confirmed) return;
      const availability = normalizeAvailability(game.user.getFlag(MODULE_ID, FLAG_KEY));
      delete availability.weeks[weekKey(this.weekStart)];
      await game.user.setFlag(MODULE_ID, FLAG_KEY, availability);
      ui.notifications.info("Tu horario de esta semana se ha borrado.");
      this.render(false);
    });
  }

  async _updateObject(_event, formData) {
    const expanded = foundry.utils.expandObject(formData);
    const schedule = {};
    for (const [dayKey] of DAYS) {
      const day = emptyDay();
      const submitted = expanded.days?.[dayKey] ?? {};
      for (const [slotKey] of SLOTS) day[slotKey] = submitted[slotKey] === true;
      day.note = submitted.note ?? "";
      schedule[dayKey] = day;
    }
    const availability = normalizeAvailability(game.user.getFlag(MODULE_ID, FLAG_KEY));
    availability.weeks[weekKey(this.weekStart)] = normalizeSchedule(schedule);
    await game.user.setFlag(MODULE_ID, FLAG_KEY, availability);
    ui.notifications.info(`Disponibilidad guardada para la semana ${formatWeekRange(this.weekStart)}.`);
    this.render(false);
  }
}

let scheduleApp;

function openSchedule() {
  scheduleApp ??= new RoleScheduleApp();
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
  game.settings.registerMenu(MODULE_ID, "openSchedule", {
    name: "Abrir horarios de rol",
    label: "Abrir horario",
    hint: "Indica cuándo puedes jugar y consulta la disponibilidad del grupo.",
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

Hooks.on("updateUser", (_user, changes) => {
  const flagChanges = foundry.utils.getProperty(changes, `flags.${MODULE_ID}`);
  if (!flagChanges || !scheduleApp?.rendered) return;
  scheduleApp.render(false);
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { open: openSchedule };
});
