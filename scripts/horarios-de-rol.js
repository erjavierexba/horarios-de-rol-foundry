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

function escapeSelector(value) {
  if (globalThis.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

class RoleScheduleApp extends FormApplication {
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
    const mine = normalizeSchedule(game.user.getFlag(MODULE_ID, FLAG_KEY));
    const users = game.users
      .filter((user) => !user.isGM || user.active || user.getFlag(MODULE_ID, FLAG_KEY))
      .map((user) => ({
        id: user.id,
        name: user.name,
        color: user.color?.css ?? user.color ?? "#6c8cff",
        schedule: normalizeSchedule(user.getFlag(MODULE_ID, FLAG_KEY))
      }));

    return {
      ...context,
      userName: game.user.name,
      days: DAYS.map(([key, label]) => ({
        key,
        label,
        note: mine[key].note,
        slots: SLOTS.map(([slotKey, slotLabel, icon]) => ({
          key: slotKey,
          label: slotLabel,
          icon,
          checked: mine[key][slotKey]
        }))
      })),
      overview: DAYS.map(([key, label]) => ({
        key,
        label,
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
    html.find("[data-action='clear']").on("click", async () => {
      const confirmed = await Dialog.confirm({
        title: "Borrar mi horario",
        content: "<p>¿Quieres borrar toda tu disponibilidad y tus notas?</p>"
      });
      if (!confirmed) return;
      await game.user.setFlag(MODULE_ID, FLAG_KEY, normalizeSchedule());
      ui.notifications.info("Tu horario se ha borrado.");
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
    await game.user.setFlag(MODULE_ID, FLAG_KEY, normalizeSchedule(schedule));
    ui.notifications.info("Tu disponibilidad se ha guardado.");
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

Hooks.on("updateUser", (user, changes) => {
  const flagChanges = foundry.utils.getProperty(changes, `flags.${MODULE_ID}`);
  if (!flagChanges || !scheduleApp?.rendered) return;
  const selector = `.role-schedule-user[data-user-id="${escapeSelector(user.id)}"]`;
  if (scheduleApp.element?.find?.(selector).length || user.id === game.user.id) scheduleApp.render(false);
  else scheduleApp.render(false);
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { open: openSchedule };
});
