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

const REFRESH_MS = 60000;
const app = document.getElementById("app");
const toastBox = document.getElementById("toast");

const state = {
  groupId: "",
  group: null,
  userId: "",
  weekStart: startOfWeek(new Date()),
  schedules: {},
  mine: emptySchedule(),
  dirty: false,
  sending: false
};

// ---------- Utilidades ----------

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[char]);
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* sin almacenamiento: no pasa nada */ }
}

function toast(message, kind = "info") {
  toastBox.textContent = message;
  toastBox.className = `toast visible ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastBox.className = "toast"; }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
  return data;
}

function emptySchedule() {
  return Object.fromEntries(DAYS.map(([key]) => [key, { morning: false, afternoon: false, night: false, note: "" }]));
}

function cloneSchedule(schedule) {
  return JSON.parse(JSON.stringify(schedule ?? emptySchedule()));
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

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function shortDate(date) {
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
}

function formatWeekRange(value) {
  const start = startOfWeek(value);
  const end = addDays(start, 6);
  const month = (date) => date.toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()} ${month(start)} ${start.getFullYear()} — ${end.getDate()} ${month(end)} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()} ${month(start)} — ${end.getDate()} ${month(end)} ${end.getFullYear()}`;
  }
  return `${start.getDate()} — ${end.getDate()} ${month(end)} ${end.getFullYear()}`;
}

function currentUser() {
  return state.group?.users.find((user) => user.id === state.userId) ?? null;
}

function setUrl(params) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
}

// ---------- Pantallas ----------

function renderMessage(title, body, action = "") {
  app.innerHTML = `
    <section class="card center-card">
      <div class="hero-mark"><i class="fas fa-calendar-check"></i></div>
      <h1>${escapeHtml(title)}</h1>
      <p>${body}</p>
      ${action}
    </section>`;
}

function renderCodeScreen(error = "") {
  renderMessage(
    "Horarios de rol",
    "Pega el código del grupo que te ha pasado el máster (lo encuentra en Foundry, en la ventana del horario).",
    `<form class="stack" id="code-form">
       <input class="text-input" name="code" placeholder="Código del grupo" autocomplete="off" required>
       ${error ? `<p class="error-text">${escapeHtml(error)}</p>` : ""}
       <button class="primary-button" type="submit"><i class="fas fa-arrow-right"></i> Continuar</button>
     </form>`
  );
  document.getElementById("code-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code").toString().trim();
    const match = code.match(/[?&]g=([A-Za-z0-9]+)/);
    loadGroup(match ? match[1] : code);
  });
}

function renderLogin(preselected = "") {
  const group = state.group;
  const options = group.users.map((user) => `
    <option value="${escapeHtml(user.id)}" ${user.id === preselected ? "selected" : ""}>
      ${escapeHtml(user.name)}${user.isGM ? " (máster)" : ""}
    </option>`).join("");
  app.innerHTML = `
    <section class="card center-card">
      <div class="hero-mark"><i class="fas fa-dice-d20"></i></div>
      <p class="eyebrow">${escapeHtml(group.system || "PARTIDA")}</p>
      <h1>${escapeHtml(group.name)}</h1>
      <p>Elige tu usuario de Foundry para rellenar tu disponibilidad.</p>
      <form class="stack" id="login-form">
        <label class="field">
          <span>Usuario</span>
          <select class="text-input" name="user" required>
            <option value="" disabled ${preselected ? "" : "selected"}>Elige quién eres…</option>
            ${options}
          </select>
        </label>
        <button class="primary-button" type="submit"><i class="fas fa-right-to-bracket"></i> Entrar</button>
      </form>
    </section>`;
  document.getElementById("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const userId = new FormData(event.currentTarget).get("user")?.toString() ?? "";
    if (!group.users.some((user) => user.id === userId)) return;
    state.userId = userId;
    storageSet(`horarios:${state.groupId}:user`, userId);
    setUrl({ u: null });
    openWeek(state.weekStart);
  });
}

function renderMain() {
  const user = currentUser();
  const group = state.group;
  const isCurrentWeek = weekKey(state.weekStart) === weekKey(new Date());
  app.innerHTML = `
    <header class="hero">
      <div class="hero-mark"><i class="fas fa-calendar-check"></i></div>
      <div class="hero-copy">
        <p class="eyebrow">${escapeHtml(group.name)}${group.system ? ` · ${escapeHtml(group.system)}` : ""}</p>
        <h1>Disponibilidad de ${escapeHtml(user.name)}</h1>
        <p>Marca cuándo puedes jugar y pulsa <strong>Enviar semana</strong>.</p>
      </div>
      <button type="button" class="ghost-button" data-action="logout">
        <i class="fas fa-user-pen"></i> Cambiar usuario
      </button>
    </header>

    <nav class="week-navigation" aria-label="Cambiar semana">
      <button type="button" class="icon-button" data-week-shift="-1" title="Semana anterior"><i class="fas fa-chevron-left"></i></button>
      <div class="week-navigation-title">
        <span>${isCurrentWeek ? "ESTA SEMANA" : `SEMANA ${weekNumber(state.weekStart)}`}</span>
        <strong>${formatWeekRange(state.weekStart)}</strong>
      </div>
      <button type="button" class="today-button" data-action="current-week" ${isCurrentWeek ? "disabled" : ""}><i class="fas fa-calendar-day"></i> Hoy</button>
      <button type="button" class="icon-button" data-week-shift="1" title="Semana siguiente"><i class="fas fa-chevron-right"></i></button>
    </nav>

    <main class="layout">
      <form class="editor" id="editor" autocomplete="off">
        <div class="editor-heading">
          <h2>Mi disponibilidad</h2>
          <span id="dirty-flag" class="dirty-flag" hidden><i class="fas fa-circle"></i> Sin enviar</span>
        </div>
        <div class="day-list">
          ${DAYS.map(([key, label], index) => `
            <article class="day-card">
              <div class="day-date"><strong>${label}</strong><span>${shortDate(addDays(state.weekStart, index))}</span></div>
              <div class="slot-segments">
                ${SLOTS.map(([slot, slotLabel, icon]) => `
                  <label class="slot-toggle" title="${slotLabel}">
                    <input type="checkbox" data-day="${key}" data-slot="${slot}" ${state.mine[key][slot] ? "checked" : ""}>
                    <span><i class="fas ${icon}"></i>${slotLabel}</span>
                  </label>`).join("")}
              </div>
              <input class="day-note" type="text" data-day="${key}" data-note maxlength="240"
                     value="${escapeHtml(state.mine[key].note)}" placeholder="Nota: p. ej., solo desde las 18 h">
            </article>`).join("")}
        </div>
        <div class="actions">
          <button type="button" class="danger-button" data-action="clear"><i class="fas fa-trash-can"></i> Borrar semana</button>
          <button type="submit" class="primary-button" id="send-button"><i class="fas fa-paper-plane"></i> Enviar semana</button>
        </div>
      </form>

      <section class="overview" id="overview"></section>
    </main>`;

  bindMain();
  renderOverview();
  updateDirty();
}

function renderOverview() {
  const container = document.getElementById("overview");
  if (!container) return;
  const schedules = { ...state.schedules, [state.userId]: state.mine };
  const users = state.group.users
    .map((user) => ({ ...user, schedule: schedules[user.id] }))
    .filter((user) => user.schedule && (!user.isGM || user.id === state.userId || hasData(user.schedule)));

  const days = DAYS.map(([key, label], index) => ({
    key,
    label,
    date: shortDate(addDays(state.weekStart, index)),
    slots: SLOTS.map(([slot, slotLabel, icon]) => ({
      slot, slotLabel, icon, users: users.filter((user) => user.schedule[key][slot])
    })),
    notes: users.filter((user) => user.schedule[key].note)
  }));
  const best = Math.max(0, ...days.flatMap((day) => day.slots.map((slot) => slot.users.length)));

  container.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">TODO EL GRUPO</p>
        <h2>Cuándo podemos jugar</h2>
        ${best ? `<p class="best-legend"><i class="fas fa-circle"></i> Mayor coincidencia: ${best}</p>` : `<p class="muted">Nadie ha marcado nada todavía.</p>`}
      </div>
      <div class="group-icon"><i class="fas fa-user-group"></i></div>
    </div>
    <div class="overview-days">
      ${days.map((day) => `
        <article class="overview-day">
          <header><h3>${day.label}</h3><span>${day.date}</span></header>
          <div class="overview-slots">
            ${day.slots.map((slot) => `
              <div class="overview-slot ${best && slot.users.length === best ? "best-slot" : ""}">
                <h4><span><i class="fas ${slot.icon}"></i>${slot.slotLabel}</span><b>${slot.users.length}</b></h4>
                <div class="player-chips">
                  ${slot.users.map((user) => `
                    <span class="player-chip" style="--user-color:${escapeHtml(user.color)}"><i class="fas fa-circle"></i>${escapeHtml(user.name)}</span>`).join("") || `<span class="nobody">—</span>`}
                </div>
              </div>`).join("")}
          </div>
          ${day.notes.length ? `
            <div class="overview-notes">
              ${day.notes.map((user) => `<p><strong style="--user-color:${escapeHtml(user.color)}">${escapeHtml(user.name)}</strong><span>${escapeHtml(user.schedule[day.key].note)}</span></p>`).join("")}
            </div>` : ""}
        </article>`).join("")}
    </div>`;
}

function hasData(schedule) {
  return DAYS.some(([key]) => schedule[key].note || SLOTS.some(([slot]) => schedule[key][slot]));
}

function updateDirty() {
  const flag = document.getElementById("dirty-flag");
  if (flag) flag.hidden = !state.dirty;
  const button = document.getElementById("send-button");
  if (button) {
    button.disabled = state.sending;
    button.innerHTML = state.sending
      ? '<i class="fas fa-spinner fa-spin"></i> Enviando…'
      : '<i class="fas fa-paper-plane"></i> Enviar semana';
  }
}

function bindMain() {
  const editor = document.getElementById("editor");
  editor.addEventListener("change", (event) => {
    const input = event.target;
    if (input.dataset.slot) state.mine[input.dataset.day][input.dataset.slot] = input.checked;
    state.dirty = true;
    updateDirty();
    renderOverview();
  });
  editor.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.hasAttribute("data-note")) return;
    state.mine[input.dataset.day].note = input.value;
    state.dirty = true;
    updateDirty();
  });
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    sendWeek();
  });

  app.querySelectorAll("[data-week-shift]").forEach((button) => button.addEventListener("click", () => {
    openWeek(addDays(state.weekStart, Number(button.dataset.weekShift) * 7));
  }));
  app.querySelector("[data-action='current-week']").addEventListener("click", () => openWeek(new Date()));
  app.querySelector("[data-action='clear']").addEventListener("click", () => {
    if (!confirm(`¿Borrar tu disponibilidad y tus notas de la semana ${formatWeekRange(state.weekStart)}?`)) return;
    state.mine = emptySchedule();
    sendWeek("Semana borrada.");
  });
  app.querySelector("[data-action='logout']").addEventListener("click", () => {
    if (state.dirty && !confirm("Tienes cambios sin enviar. ¿Cambiar de usuario igualmente?")) return;
    state.dirty = false;
    storageSet(`horarios:${state.groupId}:user`, null);
    const previous = state.userId;
    state.userId = "";
    renderLogin(previous);
  });
}

// ---------- Datos ----------

async function loadGroup(groupId) {
  state.groupId = groupId;
  try {
    const { group } = await api(`/groups/${encodeURIComponent(groupId)}`);
    state.group = group;
  } catch (error) {
    setUrl({ g: null, u: null });
    renderCodeScreen(error.message);
    return;
  }
  setUrl({ g: groupId });
  document.title = `${state.group.name} · Horarios de rol`;

  const params = new URLSearchParams(location.search);
  const fromLink = params.get("u") ?? "";
  const remembered = storageGet(`horarios:${groupId}:user`) ?? "";
  const known = (id) => state.group.users.some((user) => user.id === id);

  if (known(remembered) && (!fromLink || fromLink === remembered)) {
    state.userId = remembered;
    openWeek(state.weekStart);
  } else {
    renderLogin(known(fromLink) ? fromLink : "");
  }
}

async function fetchWeek() {
  const { schedules } = await api(`/groups/${encodeURIComponent(state.groupId)}/weeks/${weekKey(state.weekStart)}`);
  state.schedules = schedules;
}

async function openWeek(date) {
  if (state.dirty && !confirm("Tienes cambios sin enviar en esta semana. ¿Descartarlos?")) return;
  state.weekStart = startOfWeek(date);
  state.dirty = false;
  app.innerHTML = `<p class="loading"><i class="fas fa-spinner fa-spin"></i> Cargando semana…</p>`;
  try {
    await fetchWeek();
  } catch (error) {
    renderMessage("No se ha podido cargar la semana", escapeHtml(error.message),
      `<button class="primary-button" id="retry"><i class="fas fa-rotate"></i> Reintentar</button>`);
    document.getElementById("retry").addEventListener("click", () => openWeek(state.weekStart));
    return;
  }
  state.mine = cloneSchedule(state.schedules[state.userId]);
  renderMain();
}

async function sendWeek(successMessage = "Semana enviada.") {
  if (state.sending) return;
  state.sending = true;
  updateDirty();
  const week = weekKey(state.weekStart);
  try {
    await api(`/groups/${encodeURIComponent(state.groupId)}/availability`, {
      method: "POST",
      body: JSON.stringify({ userId: state.userId, weeks: { [week]: state.mine } })
    });
    state.schedules[state.userId] = cloneSchedule(state.mine);
    state.dirty = false;
    toast(successMessage, "success");
    if (successMessage !== "Semana enviada.") renderMain();
  } catch (error) {
    toast(`No se ha podido enviar: ${error.message}`, "error");
  } finally {
    state.sending = false;
    updateDirty();
  }
}

async function backgroundRefresh() {
  if (document.visibilityState !== "visible" || !state.userId || !document.getElementById("overview")) return;
  try {
    await fetchWeek();
    renderOverview();
  } catch { /* se reintentará en el siguiente ciclo */ }
}

setInterval(backgroundRefresh, REFRESH_MS);
document.addEventListener("visibilitychange", backgroundRefresh);
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

const initialGroup = new URLSearchParams(location.search).get("g");
if (initialGroup) loadGroup(initialGroup);
else renderCodeScreen();
