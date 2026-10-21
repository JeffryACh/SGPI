"use strict";
/* =====================================================================
   Autenticación (login real contra la API)
   POST {API_URL}/auth/login  { correo, password }
   200 -> { id_usuario, nombre, correo, roles: ["Investigador", ...] }
   401 -> credenciales inválidas o usuario inactivo
   ===================================================================== */

const API_URL = "http://localhost:3001",
  SESSION_KEY = "sgpi-session";
const ROLE_KEYS = {
  Investigador: "investigador",
  Vinculación: "vinculacion",
  "Comité Técnico": "comite",
  "Consejo de Escuela": "consejo",
  "Dirección de Investigación": "direccion",
  CIE: "cie",
};
// La sesión solo recuerda quién ingresó (nunca la contraseña). Sin un token emitido por el backend es estado de interfaz, no seguridad real.
let session = null;
try {
  const s = JSON.parse(localStorage.getItem(SESSION_KEY));
  if (
    s &&
    s.user &&
    Array.isArray(s.user.roles) &&
    s.user.roles.length &&
    ROLE_KEYS[s.user.roles[0]]
  )
    session = s;
} catch {}
const setSession = (s) => {
  session = s;
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
};
const initials = (n) =>
  String(n)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
async function apiLogin(correo, password) {
  let res;
  try {
    res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo, password }),
    });
  } catch {
    throw new AuthError("network");
  }
  if (res.status === 401) throw new AuthError("credentials");
  if (!res.ok) throw new AuthError("server");
  try {
    return await res.json();
  } catch {
    throw new AuthError("server");
  }
}
const LOGIN_ERRORS = {
  credentials: "Correo o contraseña incorrectos.",
  network:
    "No se pudo conectar con el servidor. Verifica que el backend esté en ejecución.",
  server: "El servidor no pudo procesar el acceso. Inténtalo de nuevo.",
  noroles:
    "Tu usuario no tiene un rol válido asignado. Contacta a un administrador.",
};

let apiProposalsCache = null;
let apiCatalogsCache = null;
const apiDossierCache = {};
const apiDossierLoading = {};

let numspropuestas = null;
async function numsPropuestas() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(`${API_URL}/propuestas/dashboardpropuestas?id_usuario=${idUsuario}`);
    if (res.ok) numspropuestas = await res.json(); // { total, formulacion, ejecucion, cerradas }
  } catch (err) {
    console.warn("numsPropuestas error:", err);
  }
  return numspropuestas;
}

let propuestamasreciente = null;
async function propuestaMasReciente() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(`${API_URL}/propuestas/propuestaMasReciente?id_usuario=${idUsuario}`);
    if (res.ok) propuestamasreciente = await res.json(); // { total, formulacion, ejecucion, cerradas }
  } catch (err) {
    console.warn("numsPropuestas error:", err);
  }
  return propuestamasreciente;
}

let top3propuestasmasrecientes = null
async function top3PropuestasMasRecientes() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  const data = await apiGet(`/propuestas/top3PropuestaMasReciente?id_usuario=${idUsuario}`);
  if (Array.isArray(data)) {
    top3propuestasmasrecientes = data.map((p) => ({
      id: p.id,
      code: `SI-${p.id}`,
      title: p.title,
      type: p.tipo,
      period: "-",
      status: p.status,
      amount: Number(p.amount) || 0,
    }));
  }
  return top3propuestasmasrecientes;
}

let notificaciones = null;
async function Notificaciones() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(`${API_URL}/notificaciones/notificaciones?id_usuario=${idUsuario}`);
    if (res.ok) notificaciones = await res.json(); // { total, formulacion, ejecucion, cerradas }
  } catch (err) {
    console.warn("numsPropuestas error:", err);
  }
  return notificaciones;
}

async function marcarLeida(idNotif) {
  const n = (notificaciones ?? []).find((x) => x.id_notificacion === idNotif);
  if (!n || n.leida) return;
  n.leida = true; // optimista
  //await apiPatch(`/notificaciones/${idNotif}/leer?id_usuario=${session.user.id_usuario}`, {});
}

async function marcarTodasLeidas() {
  (notificaciones ?? []).forEach((n) => (n.leida = true));
  //await apiPatch(`/notificaciones/leer-todas?id_usuario=${session.user.id_usuario}`, {});
}

async function apiGet(endpoint) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn("apiGet:", endpoint, err);
  }
  return null;
}

async function apiPost(endpoint, body) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn("apiPost:", endpoint, err);
  }
  return null;
}

async function apiPatch(endpoint, body) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn("apiPatch:", endpoint, err);
  }
  return null;
}

async function fetchCatalogs() {
  if (apiCatalogsCache) return apiCatalogsCache;
  const data = await apiGet("/catalogos");
  if (data) apiCatalogsCache = data;
  return apiCatalogsCache;
}

async function loadApiProposals(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== "Todas" && v !== "Todos") {
      query.set(k, v);
    }
  }
  const qs = query.toString();
  const data = await apiGet(`/propuestas${qs ? "?" + qs : ""}`);
  if (Array.isArray(data)) {
    apiProposalsCache = data.map((p) => ({
      id: p.id_propuesta,
      code: p.id_propuesta === 1 ? "SI-2027-014" : (p.id_propuesta === 2 ? "SI-2024-008" : (p.id_propuesta === 3 ? "SI-2025-019" : (p.id_propuesta === 4 ? "SI-2026-033" : `SI-2027-00${p.id_propuesta}`))),
      title: p.titulo,
      type: p.nombre_modalidad,
      period: p.id_propuesta === 2 ? "2024–2025" : (p.id_propuesta === 3 ? "2025–2026" : "2027–2028"),
      status: p.nombre_estado,
      amount: Number(p.monto_total) || 0,
      school: p.nombre_escuela,
      leader: p.nombre_lider,
      raw: p,
    }));
    return apiProposalsCache;
  }
  return null;
}

const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  "₡" + Number(n).toLocaleString("es-CR", { maximumFractionDigits: 0 });
const paths = {
  home: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  folder: "M3 6h6l2 2h10v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z",
  calendar: "M4 5h16v16H4ZM8 3v4m8-4v4M4 10h16",
  inbox: "M4 4h16v16H4Zm0 10h5l2 3h2l2-3h5",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  bell: "M18 8a6 6 0 0 0-12 0v6l-2 3h16l-2-3Zm-8 12h4",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-2a8 8 0 0 1 16 0v2",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  back: "M20 12H4m6-6-6 6 6 6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  file: "M5 2h9l5 5v15H5Zm9 0v6h5M8 12h8m-8 4h8",
  upload: "M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6",
  info: "M12 11v6m0-10v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  alert: "M12 3 2 21h20Zm0 6v5m0 3v1",
  close: "m6 6 12 12M6 18 18 6",
  logout: "M9 3H3v18h6m5-15 6 6-6 6m-7-6h13",
  download: "M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4",
  edit: "m15 3 6 6-12 12H3v-6Zm-10 10 6 6",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Zm-5 10 3 3 7-7",
};
const icon = (name) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name] || paths.file}"/></svg>`;
const roles = {
  investigador: {
    label: "Investigador proponente",
    name: "Laura Méndez",
    initials: "LM",
    screen: "02",
  },
  vinculacion: {
    label: "Centro de Vinculación",
    name: "Mariana Solís",
    initials: "MS",
    screen: "23",
  },
  comite: {
    label: "Comité Técnico",
    name: "Gabriel Sánchez",
    initials: "GS",
    screen: "24",
  },
  consejo: {
    label: "Consejo de Escuela",
    name: "Patricia Vargas",
    initials: "PV",
    screen: "25",
  },
  direccion: {
    label: "Dirección de Investigación",
    name: "Elena Chacón",
    initials: "EC",
    screen: "26",
  },
  cie: { label: "CIE", name: "Ricardo Mora", initials: "RM", screen: "27" },
};
const defaultState = {
  role: "investigador",
  stage: "En formulación",
  read: false,
  mode: "Desarrollo tecnológico",
  theme: "light",
  largeText: false,
  roleOrder: [
    "investigador",
    "vinculacion",
    "comite",
    "consejo",
    "direccion",
    "cie",
  ],
  saved: {},
  attachments: 4,
  teamAdded: false,
  reviewed: false,
  budget: [
    {
      name: "Equipo de laboratorio",
      code: "5-01-06-01",
      a: 1400000,
      b: 0,
      detail:
        "Sensores y equipo de calibración; compra en primer semestre de 2027.",
    },
    {
      name: "Materiales y suministros",
      code: "2-03-04-01",
      a: 1000000,
      b: 1600000,
      detail: "Componentes eléctricos y consumibles para integración y campo.",
    },
    {
      name: "Servicios de laboratorio",
      code: "1-04-01-01",
      a: 1440000,
      b: 2040000,
      detail: "Análisis de referencia y verificación de mediciones.",
    },
    {
      name: "Beca estudiante asistente especial",
      code: "6-02-02-08",
      a: 960000,
      b: 960000,
      detail:
        "400 horas/año × ₡2.400. Planificación: 10 h/semana durante 40 semanas, hasta 10 meses.",
    },
  ],
  scores: {},
  notRecommended: false,
  search: "",
  historyStatus: "Todos",
  resolution: "Aprobada",
};
let state = structuredClone(defaultState);
try {
  state = {
    ...state,
    ...JSON.parse(localStorage.getItem("sgpi-demo") || "{}"),
  };
} catch {}
// Versiones anteriores guardaban lo escrito en el login (incluida la contraseña) en localStorage: se descarta.
if (state.saved) {
  delete state.saved["login:email"];
  delete state.saved["login:password"];
}
let current = "01",
  modalName = null,
  previousFocus = null,
  activeFilter = "Todas",
  dossierTab = "Resumen",
  userMenuOpen = false;
const save = () => localStorage.setItem("sgpi-demo", JSON.stringify(state));
const screen = (id) => SGPI_CONTENT.screens.find((s) => s.id === id);
// Persona que se muestra en pantalla: la real si el rol activo es uno de los suyos; si se cambió a un rol de demostración, el nombre de ejemplo.
const person = () => {
  const r = roles[state.role];
  return session && session.user.roles.some((n) => ROLE_KEYS[n] === state.role)
    ? {
        ...r,
        name: session.user.nombre,
        initials: initials(session.user.nombre),
      }
    : r;
};
const homeFor = () => (state.role === "investigador" ? "02" : "21");
function applyRole(key) {
  state.role = key;
  state.viewProposal = "SI-2027-014";
  state.stage = {
    investigador: state.stage,
    vinculacion: "En revisión de Vinculación",
    comite: "En evaluación técnica",
    consejo: "En evaluación técnica",
    direccion: "Sometida",
    cie: "Dictaminada",
  }[key];
}
const totalA = () => state.budget.reduce((a, r) => a + Number(r.a), 0),
  totalB = () => state.budget.reduce((a, r) => a + Number(r.b), 0);
const budgetValid = () =>
  totalA() <= 5000000 &&
  totalB() <= 5000000 &&
  state.budget[0].b === 0 &&
  state.budget[3].a >= 960000 &&
  state.budget[3].b >= 960000;
const optionHelp = {
  Inicio: "Resumen y tareas pendientes.",
  "Mis propuestas": "Consulta o continúa tus propuestas.",
  "Bandeja de trabajo": "Expedientes asignados a tu rol.",
  Convocatorias: "Fechas, requisitos e instrumentos vigentes.",
  "Consulta histórica": "Busca expedientes y su trazabilidad.",
  "Mi perfil": "Cuenta, rol activo y preferencias.",
  "Cerrar sesión": "Cierra tu sesión en el sistema.",
  "Nueva propuesta": "Crea un borrador para la convocatoria vigente.",
  "Abrir expediente": "Consulta información, documentos y decisiones.",
  "Guardar borrador": "Conserva los cambios en este navegador.",
  "Guardar y continuar": "Valida la sección y avanza al siguiente paso.",
};
const tooltipAttrs = (label) =>
  optionHelp[label]
    ? `class="has-tooltip" data-tooltip="${esc(optionHelp[label])}" title="${esc(optionHelp[label])}"`
    : "";
const btn = (label, target, style = "", ic = "", attrs = "") =>
  `<button class="btn ${style} ${optionHelp[label] ? "has-tooltip" : ""}" ${target ? `data-go="${target}"` : ""} ${optionHelp[label] ? `data-tooltip="${esc(optionHelp[label])}" title="${esc(optionHelp[label])}"` : ""} ${attrs}>${ic ? icon(ic) : ""}${esc(label)}</button>`;
const act = (label, action, style = "", ic = "", attrs = "") =>
  btn(label, null, style, ic, `data-action="${action}" ${attrs}`);
const badge = (text, type = "") =>
  `<span class="badge ${type}"><span class="dot"></span>${esc(text)}</span>`;
const notice = (title, body, type = "") =>
  `<div class="notice ${type}">${icon(type === "warning" ? "alert" : "info")}<div><strong>${esc(title)}</strong><p>${esc(body)}</p></div></div>`;
const card = (title, body, action = "") =>
  `<section class="card card-pad">${title ? `<div class="section-head"><h2>${title}</h2>${action}</div>` : ""}${body}</section>`;
const table = (heads, rows, footer = "") =>
  `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${footer ? `<div class="table-foot">${footer}</div>` : ""}`;
const definition = (items) =>
  `<dl class="definition">${items.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${b}</dd></div>`).join("")}</dl>`;
const tabs = (items, selected, attr = "data-tab") =>
  `<div class="tabs">${items.map((t) => `<button class="tab ${t === selected ? "active" : ""}" ${attr}="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
function field(
  label,
  value = "",
  kind = "text",
  help = "",
  required = false,
  key = "",
) {
  const k = key || `${current}:${label}`,
    val = state.saved[k] ?? value,
    id = "f-" + k.replace(/[^\w]/g, "-"),
    req = required ? "required" : "",
    attr = `id="${id}" data-field="${esc(k)}" ${req}`;
  let control;
  if (kind === "textarea")
    control = `<textarea ${attr} rows="3">${esc(val)}</textarea>`;
  else if (kind === "select") {
    const opts = Array.isArray(value) ? value : [value];
    control = `<select ${attr}>${opts.map((v) => `<option ${v === val ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
  } else if (kind === "checkbox")
    return `<label class="checkline"><input type="checkbox" ${attr} ${val === true ? "checked" : ""}>${esc(label)}</label>`;
  else if (kind === "file")
    control = `<div class="doc-row"><span class="doc-icon">PDF</span><div class="grow"><strong>${esc(val)}</strong></div>${act("Adjuntar", "upload", "secondary compact", "upload")}</div>`;
  else
    control = `<input ${attr} type="${["email", "number", "password", "date", "search"].includes(kind) ? kind : "text"}" value="${esc(val)}" ${kind === "readonly" ? "readonly" : ""}>`;
  return `<div class="field"><label for="${id}">${esc(label)}${required ? ' <span class="required-star">*</span>' : ""}</label>${control}${help ? `<span class="help">${esc(help)}</span>` : ""}<span class="error-msg" hidden>Completa este campo para continuar.</span></div>`;
}
function fieldsFor(id) {
  return (screen(id).fields || [])
    .map((f) =>
      field(
        f.label,
        f.value,
        f.kind === "date"
          ? "text"
          : f.kind === "radio"
            ? "select"
            : f.kind === "tags"
              ? "text"
              : f.kind,
        f.help || "",
        f.required,
      ),
    )
    .join("");
}
function doc(name, meta = "Versión 1.0", action = "preview") {
  return `<div class="doc-row"><span class="doc-icon">${/xlsx/i.test(name) ? "XLSX" : "PDF"}</span><div class="grow"><strong>${esc(name)}</strong><small>${esc(meta)}</small></div>${act("Ver", action, "text compact", "file", `data-doc="${esc(name)}"`)}</div>`;
}

function projectRows(list = (top3propuestasmasrecientes ?? [])) {
  return list.map((p, i) => [
    `<span class="project-code">${p.code}</span><span class="project-name">${p.title}</span><span class="small muted">${p.type}</span>`,
    p.period,
    badge(p.code === "SI-2027-014" ? state.stage : p.status),
    money(p.amount),
    btn(
      p.code === "SI-2027-014" &&
        state.stage === "En formulación" &&
        current === "06"
        ? "Continuar"
        : "Ver expediente",
      p.code === "SI-2027-014" &&
        state.stage === "En formulación" &&
        current === "06"
        ? "08"
        : "22",
      "text compact",
      "arrow",
      `data-proposal="${p.code}"`,
    ),
  ]);
}
function navItem(label, id, ic, active) {
  return `<button class="nav-item ${active ? "active" : ""} ${optionHelp[label] ? "has-tooltip" : ""}" data-go="${id}" ${optionHelp[label] ? `data-tooltip="${esc(optionHelp[label])}" title="${esc(optionHelp[label])}"` : ""}>${icon(ic)}${label}</button>`;
}
function shell(body, title, description = "", headingActions = "") {
  const r = person(),
    research = state.role === "investigador",
    admin = state.role === "direccion",
    historical = admin || state.role === "cie";
  const module = (screen(current) || {}).module || "Expediente";
  return `<div class="app"><aside class="sidebar"><div class="brand"><div class="brand-mark">S</div><div><div class="brand-name">SGPI</div><span class="tec-wordmark">Tecnológico de Costa Rica</span></div></div><nav aria-label="Navegación principal"><div class="nav-group">${navItem("Inicio", "02", "home", current === "02")}${research ? navItem("Mis propuestas", "06", "folder", +current >= 6 && +current <= 20) : navItem("Bandeja de trabajo", "21", "inbox", +current >= 21 && +current <= 27)}${research ? navItem("Convocatorias", "04", "calendar", current === "04" || current === "05") : ""}${historical ? navItem("Consulta histórica", "29", "search", current === "29" || current === "30") : ""}</div>${admin ? `<div class="nav-title" style="margin-top:28px">SUPERADMINISTRACIÓN</div><div class="nav-group">${navItem("Convocatorias", "31", "calendar", current === "31")}${navItem("Rúbricas y catálogos", "32", "settings", current === "32")}</div>` : ""}</nav><div class="nav-group" style="margin-top:auto">${navItem("Mi perfil", "33", "user", current === "33")}<button class="nav-item has-tooltip" data-action="contact" data-tooltip="Persona de contacto y canales de apoyo." title="Persona de contacto y canales de apoyo.">${icon("info")}Contacto y soporte</button><button class="nav-item has-tooltip" data-action="logout" data-tooltip="${esc(optionHelp["Cerrar sesión"])}" title="${esc(optionHelp["Cerrar sesión"])}">${icon("logout")}Cerrar sesión</button></div></aside><div class="main"><header class="topbar"><div class="topbar-context"><strong>VIE</strong></div><div class="topbar-actions"><button class="icon-btn" data-go="03" aria-label="Notificaciones">${icon("bell")}${!state.read ? '<span class="notif-dot"></span>' : ""}</button><button class="profile-btn" data-action="user-menu" aria-expanded="${userMenuOpen}" aria-haspopup="menu"><span class="avatar">${esc(r.initials)}</span><span class="profile-text"><strong>${esc(r.name)}</strong><br><span class="micro muted">${r.label}</span></span>${icon("down")}</button>${userMenuOpen ? `<div class="user-menu" role="menu"><div class="user-menu-head"><strong>${esc(r.name)}</strong><div class="micro muted">${r.label}</div></div><button role="menuitem" data-go="33">${icon("user")}Mi perfil</button><button role="menuitem" data-action="settings">${icon("settings")}Ajustes y accesibilidad</button><button role="menuitem" data-action="contact">${icon("info")}Contactar soporte</button><button role="menuitem" class="danger" data-action="logout">${icon("logout")}Cerrar sesión</button></div>` : ""}</div></header><main class="content"><div class="page-heading"><div><h1>${esc(title)}</h1>${description ? `<p class="subtitle">${esc(description)}</p>` : ""}</div>${headingActions ? `<div class="action-row">${headingActions}</div>` : ""}</div>${body}</main></div><button class="support-fab" data-action="contact" aria-label="Contactar soporte">${icon("info")}<span>Soporte</span></button></div>`;
}
const steps = [
  ["08", "Datos generales"],
  ["09", "Equipo investigador"],
  ["10", "Fundamentación"],
  ["11", "Objetivos"],
  ["12", "Metodología"],
  ["13", "Plan de acción"],
  ["14", "Gestión de riesgos"],
  ["15", "Presupuesto"],
  ["16", "Información complementaria"],
  ["17", "Documentos"],
  ["18", "Revisión y envío"],
];
function formShell(inner, id = current) {
  const idx = steps.findIndex((s) => s[0] === id);
  return `<div class="form-layout"><aside><div class="small" style="margin:0 10px 10px"><strong>Tu propuesta</strong><p class="micro muted" style="margin-top:4px">Paso ${idx + 1} de 11</p></div><div class="progress" style="margin:0 10px 18px"><span style="width:${((idx + 1) / 11) * 100}%"></span></div><nav class="stepper" aria-label="Secciones del formulario">${steps.map(([n, l], i) => `<button class="step ${i === idx ? "active" : i < idx ? "done" : ""}" data-go="${n}"><span>${i < idx ? "✓" : i + 1}</span>${l}</button>`).join("")}</nav><p class="micro muted" style="margin:20px 10px">Puedes guardar y continuar después.<br>Los campos con * son obligatorios.</p></aside><div><form id="proposal-form" class="card form-card" novalidate><div class="form-title"><h2>${esc(screen(id).title)}</h2>${badge("Borrador")}</div>${inner}<div class="form-footer"><div>${idx > 0 ? btn("Anterior", steps[idx - 1][0], "text", "back") : btn("Mis propuestas", "06", "text", "back")}</div><div class="action-row">${act("Guardar borrador", "save", "secondary")}${idx < 10 ? act("Guardar y continuar", "next", "", "arrow", `data-next="${steps[idx + 1][0]}"`) : act("Enviar a evaluación", "send", "", "arrow")}</div></div></form><div class="saved" style="margin-top:12px">${icon("check")}Cambios guardados</div></div></div>`;
}
function login() {
  return `<main class="login-simple"><div class="login-panel"><div class="brand"><div class="brand-mark">S</div><div><div class="brand-name">SGPI <span class="login-vie">/ VIE</span></div><span class="tec-wordmark">Tecnológico de Costa Rica</span></div></div><h1>Iniciar sesión</h1><p class="muted">Gestión de propuestas de investigación</p><form id="login-form" novalidate>${field("Correo institucional", "", "email", "", true, "login:email")}${field("Contraseña", "", "password", "", true, "login:password")}<div id="login-error" role="alert" aria-live="assertive"></div>${act("Ingresar", "login", "", "arrow")}<div class="login-help">${act("Ayuda para ingresar", "login-help", "text")} · ${act("Ayuda para crear cuenta", "account-help", "text")}</div></form><div class="login-help">${act("Contactar a una persona", "contact", "text", "info")}</div></div><button class="support-fab" data-action="contact" aria-label="Contactar soporte">${icon("info")}<span>Soporte</span></button></main>`;
}
function dashboard() {
  if (state.role !== "investigador")
    return shell(
      `<div class="hero"><div><h2>Una propuesta espera tu revisión</h2><p>Consulta el expediente completo antes de registrar la decisión de ${roles[state.role].label}.</p></div>${btn("Abrir bandeja", "21", "", "arrow")}</div><div class="grid three mt">${[
        ["Pendientes", "1"],
        ["En revisión", "0"],
        ["Resueltos", "3"],
      ]
        .map(
          ([a, b]) =>
            `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
        )
        .join(
          "",
        )}</div><div class="mt card">${table(["Expediente", "Etapa", "Prioridad", ""], [[`<span class="project-code">SI-2027-014</span><strong>Agua Inteligente: monitoreo de cuencas</strong>`, roles[state.role].label, badge("Dentro del plazo"), btn("Revisar", roles[state.role].screen, "text", "arrow")]])}</div>`,
      `Hola, ${person().name.split(" ")[0]}`,
      "",
      "",
    );
  return shell(
    `<div class="hero"><div><h2> ${propuestamasreciente?.titulo ?? "------"} </h2><p>Completa el presupuesto y los documentos para enviar a revisión.</p></div>${btn("Continuar propuesta", "15", "", "arrow")}</div><div class="grid four mt">${[
      ["Mis propuestas", numspropuestas?.total ?? "-", "folder"],
      ["En formulación", numspropuestas?.formulacion ?? "-", "edit"],
      ["En ejecución", numspropuestas?.ejecucion ?? "-", "clock"],
      ["Cerradas", numspropuestas?.cerradas ?? "-", "check"],
    ]
      .map(
        ([a, b, c]) =>
          `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
      )
      .join(
        "",
      )}</div><div class="two-col mt"><section class="card"><div class="card-pad section-head" style="margin-bottom:0"><h2>Mis propuestas recientes</h2>${btn("Ver todas", "06", "text compact")}</div>${table(
      ["Propuesta", "Estado", ""],
      (top3propuestasmasrecientes ?? [])
        .slice(0, 3)
        .map((p, i) => [
          `<span class="project-code">${p.code}</span><span class="project-name">${p.title}</span>`,
          badge(i === 0 ? state.stage : p.status),
          btn(
            "Abrir",
            i === 0 ? "08" : "22",
            "text compact",
            "arrow",
            `data-proposal="${p.code}"`,
          ),
        ]),
    )}</section><div class="stack">${card("Próximo vencimiento", `<div class="eyebrow">FONDOS VIE 2027</div><div style="font-size:32px;font-weight:700">28 <span style="font-size:18px;font-weight:400">sep 2026</span></div><p class="small muted" style="margin:8px 0 18px">Sometimiento formal ante VIE. Requiere evaluación y avales previos.</p>${btn("Consultar convocatoria", "05", "text", "arrow")}`)}</div></div>`,
    `Hola, ${person().name.split(" ")[0]}`,
    "",
    btn("Nueva propuesta", "07", "", "plus"),
  );
}

function notifications() {
  const all = notificaciones ?? [];
  let items = all;
  if (activeFilter === "Sin leer") items = all.filter((n) => !n.leida);
  else if (activeFilter === "Trámites") items = all.filter((n) => n.tipo === "tramite");
  else if (activeFilter === "Convocatorias") items = all.filter((n) => n.tipo === "convocatoria");

  const fecha = (s) =>
    new Date(s).toLocaleString("es-CR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const destino = (n) => (n.tipo === "convocatoria" ? "05" : n.id_propuesta ? "22" : "03");

  return shell(
    `${tabs(["Todas", "Sin leer", "Trámites", "Convocatorias"], activeFilter, "data-filter")}<div class="card card-pad">${
      items.length
        ? items
            .map(
              (n) =>
                `<div class="list-item"><div class="list-icon">${icon(n.tipo === "convocatoria" ? "calendar" : "file")}</div><div class="grow"><div class="action-row"><h3>${esc(n.titulo)}</h3>${!n.leida ? badge("Sin leer") : ""}</div><p>${esc(n.mensaje)}</p><small class="micro muted">${fecha(n.fecha_creacion)}</small></div>${btn("Ver", destino(n), "text", "arrow", `data-notif="${n.id_notificacion}" ${n.id_propuesta ? `data-proposal="SI-${n.id_propuesta}"` : ""}`)}</div>`,
            )
            .join("")
        : `<div class="empty">${icon("check")}<h2>${activeFilter === "Sin leer" ? "Estás al día" : "Sin notificaciones"}</h2><p>${activeFilter === "Sin leer" ? "No tienes notificaciones sin leer." : "No hay notificaciones en esta categoría."}</p>${act("Ver todas", "all-notifications", "secondary")}</div>`
    }</div>`,
    "Notificaciones",
    "Novedades y acciones pendientes de tus expedientes.",
    act("Marcar todas como leídas", "read", "secondary", "check"),
  );
}

function calls() {
  return shell(
    `<div class="filters mb">${field("Buscar convocatoria", "", "search", "", false, "call:query")}${field("Estado", ["Abiertas para formulación", "Todas", "Cerradas"], "select")}${act("Buscar", "filter-calls", "secondary", "search")}</div><div class="grid two"><section class="card card-pad"><div class="section-head">${badge("Formulación")}</div><h2>Fondos VIE 2027</h2><p class="small muted" style="margin:12px 0 24px">Apoyo a iniciativas de fortalecimiento, investigación y desarrollo tecnológico.</p>${definition(
      [
        ["Formulación", "28 jul – 21 ago 2026"],
        ["Sometimiento formal", "28 sep 2026"],
        ["Inicio de ejecución", "01 ene 2027"],
        ["Modalidades", "3 familias de iniciativas"],
      ],
    )}<div class="form-footer">${btn("Ver convocatoria", "05", "secondary")}${btn("Crear propuesta", "07", "", "plus")}</div></section>${card("Antes de comenzar", `<div class="timeline"><div class="event"><h3>Revisa los instrumentos vigentes</h3><p>Disposiciones, formulario, plan y presupuesto.</p></div><div class="event"><h3>Define modalidad y equipo</h3><p>Los topes y productos cambian según la iniciativa.</p></div><div class="event"><h3>Programa las revisiones</h3><p>Vinculación, Comité y consejos preceden al sometimiento.</p></div></div>`)}</div>`,
    "Convocatorias",
    "Encuentra los requisitos y las fechas para tu próxima propuesta.",
  );
}
const calendarRows = [
  ["Formulación", "28 jul – 21 ago 2026"],
  ["Vinculación", "24 – 28 ago 2026"],
  ["Evaluación técnica", "31 ago – 11 sep 2026"],
  ["Avales de consejos", "14 – 25 sep 2026"],
  ["Sometimiento formal", "28 sep 2026"],
  ["Dictamen de Dirección", "29 sep – 12 oct 2026"],
  ["Resolución CIE", "13 – 23 oct 2026"],
  ["Carta de aceptación", "02 – 06 nov 2026"],
];
function callDetail() {
  return shell(
    `<div class="two-col"><div class="stack">${card(
      "Una convocatoria, distintas formas de investigar",
      `<p class="small muted mb">Selecciona la modalidad que corresponde a los resultados esperados. Los límites se verifican por año y por iniciativa.</p>${table(
        ["Modalidad", "Duración inicial", "Tope"],
        [
          ["Fortalecimiento", "1 año", money(2000000) + " total"],
          ["Básica / aplicada", "2 años", money(4000000) + " / año"],
          ["Desarrollo tecnológico", "3 años", money(5000000) + " / año"],
        ],
      )}`,
    )}${card("Instrumentos de la convocatoria", doc("Disposiciones Fondos VIE 2027.pdf") + doc("Formulario de proyecto de investigación.docx") + doc("Plan de acción y gestión del riesgo.xlsx") + doc("Presupuesto Fondos VIE 2027.xlsx") + doc("Rúbricas de evaluación 2027.xlsx"))}${notice("No omitas las etapas previas", "Enviar a evaluación y someter ante VIE son acciones distintas. El investigador realiza el sometimiento formal después de obtener los avales.")}</div>${card("Calendario 2026", `<div class="timeline">${calendarRows.map(([a, b], i) => `<div class="event ${i === 0 ? "current" : ""}"><h3>${a}</h3><p>${b}</p></div>`).join("")}</div>`)}</div>`,
    "Fondos VIE 2027",
    "Convocatoria de investigación · Inicio de ejecución: enero de 2027",
    btn("Crear propuesta", "07", "", "plus"),
  );
}
function myProposals() {
  const list = apiProposalsCache || top3propuestasmasrecientes || [];
  let filtered = list;
  if (activeFilter === "En formulación") filtered = list.filter((p) => p.status === "En formulación");
  else if (activeFilter === "En ejecución") filtered = list.filter((p) => p.status === "En ejecución");
  else if (activeFilter === "Cerradas") filtered = list.filter((p) => p.status === "Cerrada" || p.status === "Rechazada");

  return shell(
    `${tabs(["Todas", "En formulación", "En ejecución", "Cerradas"], activeFilter, "data-filter")}<div class="card">${table(
      ["Propuesta", "Período", "Estado", "Monto", ""],
      projectRows(filtered),
      `<span>${filtered.length} propuesta${filtered.length === 1 ? "" : "s"} sincronizada${filtered.length === 1 ? "" : "s"} con PostgreSQL</span><span>Página 1 de 1</span>`,
    )}</div>`,
    "Mis propuestas",
    "Organiza tus borradores y consulta el avance de tus investigaciones.",
    btn("Nueva propuesta", "07", "", "plus"),
  );
}
function newProposal() {
  return shell(
    `<div class="two-col"><form class="card card-pad" id="modality-form"><div class="section-head"><h2>Elige la modalidad</h2>${badge("Paso inicial")}</div><div class="stack">${[
      [
        "Desarrollo tecnológico",
        "Desarrollar y validar soluciones con potencial de propiedad intelectual.",
        "Hasta 3 años · ₡5.000.000/año",
      ],
      [
        "Investigación básica o aplicada",
        "Generar conocimiento o responder a un problema mediante investigación.",
        "Hasta 2 años · ₡4.000.000/año",
      ],
      [
        "Actividad de fortalecimiento",
        "Fortalecer capacidades y preparar futuras iniciativas.",
        "1 año · ₡2.000.000 total",
      ],
    ]
      .map(
        ([a, b, c]) =>
          `<label class="radio-card"><input type="radio" name="modality" value="${a}" ${state.mode === a ? "checked" : ""}><div><h3>${a}</h3><p>${b}</p><p style="margin-top:10px"><strong>${c}</strong></p></div></label>`,
      )
      .join(
        "",
      )}</div><div class="form-footer">${btn("Cancelar", "06", "text")}${act("Crear borrador", "create-proposal", "", "arrow")}</div></form><div class="stack">${card("Para preparar tu propuesta", `<div class="list-item">${icon("user")}<div><h3>Equipo y dedicación</h3><p>Identifica participantes, responsabilidades y horas.</p></div></div><div class="list-item">${icon("calendar")}<div><h3>Plan y presupuesto</h3><p>Relaciona actividades, riesgos y recursos por año.</p></div></div><div class="list-item">${icon("file")}<div><h3>Instrumentos oficiales</h3><p>Usa la versión correspondiente a Fondos VIE 2027.</p></div></div>`)}${notice("Demostración disponible", "El recorrido completo utiliza desarrollo tecnológico. Las otras modalidades muestran sus reglas y requisitos generales.")}</div></div>`,
    "Nueva propuesta",
    "Comienza un borrador en la convocatoria Fondos VIE 2027.",
  );
}
function dataForm() {
  return `${field("Título de la propuesta", "Agua Inteligente: monitoreo de cuencas", "text", "Usa un título claro que identifique el propósito de la investigación.", true)}<div class="field-row">${field("Instancia coordinadora", ["Escuela de Ingeniería Ambiental"], "select", "", true)}${field("Modalidad", "Desarrollo tecnológico", "readonly")}</div>${field("Línea de investigación", ["Gestión integrada del recurso hídrico"], "select", "", true)}<div class="field-row">${field("Fecha de inicio", "2027-01-01", "date", "", true)}${field("Fecha de finalización", "2028-12-31", "date", "Duración propuesta: 24 meses.", true)}</div>${field("Resumen", screen("08").fields.find((f) => f.label === "Resumen").value, "textarea", "Máximo 500 palabras.", true)}${field("Palabras clave", "Calidad del agua; monitoreo; cuencas; sensores", "text", "Incluye de 4 a 6 palabras clave.", true)}<details class="accordion"><summary>Información adicional del formulario</summary>${field("Resumen en inglés", "Development and validation of a water-quality monitoring system in two pilot watersheds.", "textarea", "Máximo 500 palabras.", true)}${field("Palabras clave en inglés", "Water quality; monitoring; watersheds; sensors", "text", "4 a 6 palabras clave.", true)}${field("Prioridad nacional y ODS", "Gestión del recurso hídrico · ODS 6", "text")}${field("Continuidad y financiamiento previo", "No corresponde a una continuación; no tiene financiamiento externo.", "textarea")}${field("Instrumento jurídico / convenio", "No aplica.", "text")}${field("Vinculación con posgrado", "No aplica.", "text")}${field("Información sensible", "Documentación técnica del software, sujeta a valoración de Vinculación.", "textarea")}</details>`;
}
function teamForm() {
  return `${notice("Dedicación total: 16 horas semanales", "Se registran 8 h VIE y 8 h REC. La participación estudiantil se presupuesta aparte.")}<div class="mt">${table(
    ["Persona / instancia", "Rol", "Horas", ""],
    [
      [
        `<strong>Laura Méndez</strong><br><span class="micro muted">Ingeniería Ambiental</span>`,
        "Coordinadora",
        "8 h VIE",
        act("Editar", "team", "text compact"),
      ],
      [
        '<strong>Andrés Rojas</strong><br><span class="micro muted">Ingeniería Electrónica</span>',
        "Investigador",
        "4 h REC",
        act("Editar", "team", "text compact"),
      ],
      [
        '<strong>Sofía Vega</strong><br><span class="micro muted">Ingeniería Ambiental</span>',
        "Investigadora",
        "4 h REC",
        act("Editar", "team", "text compact"),
      ],
    ],
    state.teamAdded
      ? "<span>Participación externa: " +
          esc(state.extraPerson || "María Arias") +
          " · carta de compromiso.</span>"
      : "<span>Nombramientos: 01 ene 2027 – 31 dic 2028</span>",
  )}</div><div class="action-row mt mb">${act("Agregar participante", "team", "secondary", "plus")}</div>${field("Participación estudiantil", "Valeria Campos · 10 h/semana de beca asistente especial; validación de campo y trabajo final de graduación.", "textarea", "₡960.000 por año para 400 horas a ₡2.400/h.", true)}<details class="accordion"><summary>Colaboración externa y responsabilidades</summary><p>Las personas externas se identifican con institución, ORCID, carta de compromiso y tareas en el plan. La persona titular se registra cuando se emplean horas CONS.</p>${field("Institución externa", "Sin participantes externos en la versión inicial.", "text")}</details>`;
}
function foundationForm() {
  return `${field("Problema e importancia", screen("10").fields[0].value, "textarea", "Máximo una página.", true)}${field("Justificación", screen("10").fields[1].value, "textarea", "Explica la contribución y las personas beneficiarias.", true)}${field("Estado del arte y vacío identificado", "Revisión previa documentada: los sistemas comparados presentan limitaciones de continuidad de mediciones e integración de datos en las microcuencas del caso. El prototipo aborda ese vacío mediante calibración comparativa y registro continuo.", "textarea", "Máximo 2 páginas. Incluye al menos 10 referencias primarias WoS/Scopus de los últimos 5 años.", true)}<details class="accordion"><summary>Ver referencias y antecedentes del caso</summary><p>Referencias pendientes de completar en este ejemplo.</p>${field("Antecedentes", screen("10").fields[2].value, "textarea")}${doc("Fundamentación.pdf")}</details>`;
}
function objectiveForm() {
  return `${field("Objetivo general", screen("11").fields[0].value, "textarea", "", true)}<h3 style="margin:22px 0 16px">Objetivos específicos</h3>${screen(
    "11",
  )
    .rows.map((r) =>
      field(
        r.code,
        r.text,
        "textarea",
        "Cada objetivo se vincula con actividades y resultados.",
        true,
      ),
    )
    .join(
      "",
    )}${state.extraObjective ? field("OE4", state.extraObjective, "textarea", "Objetivo agregado en esta sesión.", true) : ""}${act("Agregar objetivo", "objective", "secondary", "plus")}`;
}
function methodologyForm() {
  return `${field("Enfoque y diseño metodológico", screen("12").fields[0].value, "textarea", "Describe enfoque, alcance y diseño.", true)}${field("Procedimientos y técnicas", screen("12").fields[1].value, "textarea", "Incluye instrumentos, variables y procedimientos de medición.", true)}${field("Usuarios y validación", "Personas responsables de la gestión de dos microcuencas piloto. La validación compara mediciones de pH, temperatura y conductividad con instrumentos de referencia; se documentan concordancia, cobertura temporal y limitaciones.", "textarea", "Justifica la selección de sitios y cómo se comprobará el desempeño.", true)}${field("Análisis de resultados", screen("12").fields[2].value, "textarea", "", true)}<details class="accordion"><summary>Productos y difusión</summary><p>Productos comprometidos para 16 h: software (activo de PI), artículo sometido WoS/Scopus y manual técnico. La validación de PI corresponde a Vinculación.</p></details>`;
}
const activities = [
  [
    "OE1",
    "Definir requerimientos y sitios",
    "Especificación de requerimientos",
    "LM · Ejecuta",
    "1–6",
  ],
  [
    "OE2",
    "Integrar y calibrar el prototipo",
    "Prototipo integrado",
    "AR · Ejecuta",
    "7–12",
  ],
  [
    "OE2",
    "Validar en dos microcuencas",
    "Datos de validación",
    "SV · Ejecuta",
    "13–20",
  ],
  [
    "OE3",
    "Evaluar desempeño y documentar",
    "Informe y manual técnico",
    "LM · Supervisa",
    "21–24",
  ],
];
function planForm() {
  return `${notice("Cada actividad conserva su trazabilidad", "Asocia objetivo, resultado, participante, responsabilidad, riesgo y plazo en meses correlativos.")}<div class="mt">${table(
    ["Objetivo / actividad", "Resultado", "Responsable", "Meses"],
    activities
      .concat(state.extraActivities || [])
      .map((r) => [
        `<span class="project-code">${r[0]}</span><strong>${r[1]}</strong>`,
        r[2],
        r[3],
        r[4],
      ]),
  )}</div><div class="action-row mt mb">${act("Agregar actividad", "activity", "secondary", "plus")}${btn("Revisar riesgos", "14", "text", "arrow")}</div><h3 class="mb">Cronograma · 24 meses</h3><div class="gantt"><div>Actividad</div>${["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"].map((x) => `<div>${x}</div>`).join("")}${activities.map((r, i) => `<div>${r[1]}</div>${Array.from({ length: 8 }, (_, j) => `<div ${j >= i * 2 && j < i * 2 + 2 ? 'class="bar"' : ""}></div>`).join("")}`).join("")}</div><details class="accordion"><summary>Giras e informes de seguimiento</summary><p>Se planifican giras de campo durante meses 13–20, informes semestrales en meses 6, 12, 18 y 24 e informes anuales en meses 12 y 24. La coordinación supervisa su entrega.</p></details>`;
}
const risks = [
  [
    "Definir requerimientos",
    "Acceso limitado a sitios",
    "Acordar accesos y sitios alternos antes de las visitas.",
    "Laura Méndez",
  ],
  [
    "Integrar y calibrar",
    "Retraso de componentes",
    "Verificar disponibilidad y opciones compatibles en el primer semestre.",
    "Andrés Rojas",
  ],
  [
    "Validar en campo",
    "Crecidas en microcuencas",
    "Programar ventanas alternas y puntos seguros de medición.",
    "Sofía Vega",
  ],
  [
    "Evaluar y documentar",
    "Pérdida de registros",
    "Respaldar y verificar integridad semanalmente.",
    "Laura Méndez",
  ],
];
function riskForm() {
  return `${notice("4 actividades · 4 riesgos asociados", "La plantilla exige identificar riesgos, mitigación y responsable para cada actividad.")}<div class="mt">${table(
    ["Actividad / riesgo", "Medida de mitigación", "Responsable"],
    risks
      .concat(state.extraRisks || [])
      .map((r) => [
        `<span class="project-code">${r[0]}</span><strong>${r[1]}</strong>`,
        r[2],
        r[3],
      ]),
  )}</div><div class="mt">${act("Agregar riesgo", "risk", "secondary", "plus")}</div><details class="accordion"><summary>Revisar consistencia con el plan</summary><p>Las medidas son realizables con los recursos y plazos de la propuesta. Los riesgos se revisarán durante cada informe de seguimiento.</p></details>`;
}
function budgetForm() {
  const valid = budgetValid();
  return `<div class="grid three mb">${[
    ["2027", totalA()],
    ["2028", totalB()],
    ["Total solicitado", totalA() + totalB()],
  ]
    .map(
      ([a, b]) =>
        `<div class="card metric"><span class="label">${a}</span><span class="value" style="font-size:23px">${money(b)}</span><span class="micro muted">${a === "Total solicitado" ? "Fondos VIE · 24 meses" : "Máximo ₡5.000.000 por año"}</span></div>`,
    )
    .join(
      "",
    )}</div>${valid ? notice("Presupuesto dentro del límite anual", "Equipo en el primer año y beca estudiantil de 10 h/semana incorporada.") : notice("Revisa el presupuesto para continuar", "El monto supera el tope anual, hay equipo en el segundo año o falta la beca mínima.", "warning")}<div class="mt">${table(
    ["Objeto de gasto", "2027", "2028", ""],
    state.budget.map((r, i) => [
      `<span class="project-code">${r.code}</span><strong>${r.name}</strong>`,
      money(r.a),
      money(r.b),
      act("Editar", "budget-edit", "text compact", "edit", `data-index="${i}"`),
    ]),
  )}</div><div class="action-row mt">${act("Agregar rubro", "budget-add", "secondary", "plus")}${act("Ver reglas de presupuesto", "budget-rules", "text")}</div><details class="accordion"><summary>Justificaciones y otras fuentes</summary>${state.budget.map((r) => `<p><strong>${r.name}.</strong> ${r.detail}</p>`).join("")}${field("Financiamiento externo / contrapartida", "Sin aportes externos.", "textarea")}</details>`;
}
function complementaryForm() {
  const ethics = [
    [
      "Participación de seres humanos",
      "No se recopilan datos de personas ni se realizan intervenciones con participantes humanos.",
    ],
    [
      "Biodiversidad y recursos genéticos",
      "No se recolectan especímenes ni material genético; solo se registran parámetros físico-químicos del agua.",
    ],
    [
      "Uso de animales",
      "No se utilizan animales ni se realizan procedimientos sobre fauna.",
    ],
    [
      "Territorios o pueblos indígenas",
      "Los sitios piloto no se ubican en territorios indígenas; cualquier cambio requerirá consulta y autorización previa.",
    ],
  ];
  return `<h3 class="mb">Madurez tecnológica y propiedad intelectual</h3><div class="field-row">${field("TRL actual", ["4", "1", "2", "3", "5", "6", "7", "8", "9"], "select", "Rango de referencia DT: 4–7.", true)}${field("TRL esperado", ["6", "1", "2", "3", "4", "5", "7", "8", "9"], "select", "Coherente con objetivos y validación.", true)}</div>${field("Potencial de propiedad intelectual", ["Sí", "No"], "select", "En desarrollo tecnológico el dictamen de Vinculación es obligatorio.", true)}${field("Activo previsto", "Software de integración y registro de mediciones ambientales.", "textarea", "Evitar divulgación previa a la valoración institucional.", true)}<details class="accordion" open><summary>Declaraciones éticas individuales</summary><p class="small muted" style="margin-top:14px">Cada aspecto se declara y justifica por separado; no se admite una respuesta general.</p><div class="ethics-grid">${ethics.map(([label, reason], i) => `<section class="ethics-item"><h3>${label}</h3>${field("¿Aplica?", ["No", "Sí"], "select", "Selecciona Sí si la actividad requiere revisión o permisos.", true, `ethics:${i}:applies`)}${field(`Justificación específica`, reason, "textarea", "Indica entidad, estado, mitigación y plazo si corresponde.", true, `ethics:${i}:reason`)}</section>`).join("")}</div></details><details class="accordion"><summary>Producción, difusión y hoja de ruta</summary><p><strong>16 h/semana:</strong> software + artículo sometido WoS/Scopus + manual técnico. Se asocian a OE2 y OE3.</p>${field("Difusión y socialización", "Sesión institucional y manual para responsables de las microcuencas, después de la revisión de PI.", "textarea")}${field("Hoja de ruta", "TRL 4 a 6: integrar, calibrar y validar en entorno relevante.", "textarea")}</details>`;
}
function documentsForm() {
  return `<div class="dropzone">${icon("upload")}<h3>Documentos de la propuesta</h3><p>Incorpora los archivos que respaldan esta versión.</p>${act("Adjuntar documento", "upload", "secondary", "plus")}</div><div class="mt">${doc("Formulario de proyecto · v1.pdf")}${doc("Plan de acción y riesgos · v1.xlsx")}${doc("Presupuesto 2027–2028 · v1.xlsx")}${state.attachments >= 4 ? doc("Fundamentación.pdf") : notice("Falta un documento obligatorio", "Incorpora el anexo de fundamentación antes del envío.", "warning")}</div><div class="mt">${notice("Dictámenes y acuerdos se agregan en su etapa", "El dictamen de Vinculación precede al Comité; los avales se requieren para el sometimiento formal. No se exige un documento antes de que pueda ser emitido.")}</div>`;
}
function reviewForm() {
  const ok = budgetValid() && state.attachments >= 4;
  return `<div class="mb"><span class="project-code">SI-2027-014 · Desarrollo tecnológico</span><h2>Agua Inteligente: monitoreo de cuencas</h2><p class="small muted" style="margin-top:8px">2027–2028 · ${money(totalA() + totalB())} · Versión 1.0</p></div><div class="review-grid">${[
    ["Datos y equipo", "08", true],
    ["Fundamentación y objetivos", "10", true],
    ["Metodología y plan", "12", true],
    ["Gestión de riesgos", "14", true],
    ["Presupuesto anual", "15", budgetValid()],
    ["Documentos obligatorios", "17", state.attachments >= 4],
  ]
    .map(
      ([a, b, c]) =>
        `<div class="review-row"><span class="ok">${c ? "✓" : "!"}</span><span>${a}<br><span class="micro muted">${c ? "Completo" : "Requiere corrección"}</span></span><button data-go="${b}">Revisar</button></div>`,
    )
    .join(
      "",
    )}</div><div class="mt">${notice("Próxima etapa: Vinculación", "Esta propuesta es de desarrollo tecnológico. Se enviará primero a revisión de PI, luego al Comité Técnico.")}</div><label class="checkline mt"><input type="checkbox" id="reviewed" ${state.reviewed ? "checked" : ""}>He revisado la información y los documentos.</label>${!ok ? notice("Aún no puedes enviar", "Corrige el presupuesto y adjunta todos los documentos señalados.", "warning") : ""}`;
}
function confirmation() {
  return shell(
    `<div class="card card-pad" style="max-width:850px;margin:auto;padding:42px"><div style="width:56px;height:56px;border-radius:50%;background:var(--soft);display:grid;place-items:center;margin-bottom:22px">${icon("check")}</div><h2 style="font-size:28px">Tu propuesta fue enviada a revisión</h2><p class="small muted" style="margin:12px 0 30px">Se registró la versión 1.0 de SI-2027-014. Podrás consultar cada cambio desde el seguimiento.</p>${definition(
      [
        ["Estado", badge("En revisión de Vinculación")],
        ["Responsable actual", "Centro de Vinculación"],
        ["Registro", "21 ago 2026"],
        ["Siguiente etapa", "Evaluación del Comité Técnico"],
      ],
    )}<div class="mt">${notice("Este envío no es el sometimiento formal", "Una vez que obtengas la evaluación técnica y los avales, deberás someter la propuesta ante VIE el 28 de septiembre.")}</div><div class="action-row mt">${btn("Ver seguimiento", "20", "", "arrow")}${btn("Mis propuestas", "06", "secondary")}</div></div>`,
    "Confirmación de envío",
    "",
  );
}
const stageList = [
  "En formulación",
  "En revisión de Vinculación",
  "En evaluación técnica",
  "Avalada",
  "Sometida",
  "Dictaminada",
  "Resuelta",
  "Aceptada",
  "En ejecución",
  "Cerrada",
];
function tracking() {
  const ix = stageList.indexOf(state.stage),
    stateText = state.stage;
  let action = notice(
    "Tu expediente está en revisión",
    "Recibirás una notificación cuando haya una decisión o se requieran ajustes.",
  );
  if (state.stage === "Avalada")
    action =
      notice(
        "Tu propuesta ya cuenta con aval",
        "El investigador debe someterla formalmente el 28 sep 2026.",
      ) +
      `<div class="mt">${act("Someter propuesta", "submit", "", "arrow")}</div>`;
  if (state.stage === "Resuelta")
    action =
      notice(
        "Resolución favorable del CIE",
        "Presenta la carta de aceptación durante el período del 2 al 6 de noviembre.",
      ) +
      `<div class="mt">${act("Presentar carta de aceptación", "acceptance", "", "upload")}</div>`;
  if (state.stage === "Aceptada")
    action = notice(
      "Carta de aceptación registrada",
      "La ejecución comienza el 1 ene 2027.",
    );
  if (state.stage === "Con observaciones")
    action =
      notice(
        "Se requieren ajustes",
        "Completa la justificación del riesgo de campo y vuelve a enviar la versión corregida.",
        "warning",
      ) +
      `<div class="mt">${btn("Atender observaciones", "14", "", "edit")}</div>`;
  if (state.stage === "Rechazada")
    action = notice(
      "Resolución: no aprobada",
      "Consulta el acuerdo motivado del CIE en el expediente. La resolución no habilita aceptación ni ejecución.",
      "warning",
    );
  if (state.stage === "En ejecución")
    action =
      notice(
        "Proyecto en ejecución",
        "Registra informes y productos; el cierre requiere el informe final y oficio de Vinculación.",
      ) +
      `<div class="mt">${act("Presentar informe", "report", "secondary", "upload")}</div>`;
  if (state.stage === "Cerrada")
    action = notice(
      "Expediente cerrado",
      "El expediente conserva documentos e historial y está disponible solo para consulta.",
    );
  return shell(
    `<div class="two-col"><div class="stack">${card("Agua Inteligente: monitoreo de cuencas", `<span class="project-code">SI-2027-014 · Versión 1.0</span><div class="action-row mt mb">${badge(stateText, "solid")}${badge("Desarrollo tecnológico")}</div>${action}<div class="stat-strip"><div><strong>${money(totalA() + totalB())}</strong><span>Monto solicitado</span></div><div><strong>24 meses</strong><span>Enero 2027 – diciembre 2028</span></div><div><strong>16 h</strong><span>Dedicación semanal</span></div></div>`)}${card("Documentos de la etapa", doc(ix >= 3 ? "Acuerdo de aval · IA-014-2026.pdf" : "Registro de envío · versión 1.0.pdf") + doc("Propuesta · SI-2027-014.pdf"))}</div>${card("Ruta del expediente", `<div class="timeline">${stageList.map((s, i) => `<div class="event ${s === state.stage ? "current" : ""}"><h3>${i < ix ? "✓ " : ""}${s}</h3><p>${["Investigador", "Vinculación", "Comité Técnico", "Consejos de Escuela", "Investigador → VIE", "Dirección de Investigación", "CIE", "Investigador", "Equipo investigador", "Dirección de Investigación"][i]}</p></div>`).join("")}</div>`)}</div>`,
    "Seguimiento de propuesta",
    "Consulta la etapa actual y la próxima acción que te corresponde.",
    btn("Abrir expediente", "22", "secondary", "folder"),
  );
}
function inbox() {
  const list = apiProposalsCache || top3propuestasmasrecientes || [];
  const pending = list.filter((p) => !["Cerrada", "Rechazada", "Aprobada por CIE", "Resuelta"].includes(p.status));
  const closed = list.filter((p) => ["Cerrada", "Rechazada", "Aprobada por CIE", "Resuelta"].includes(p.status));

  let filtered = pending;
  if (activeFilter === "En revisión") filtered = pending.filter((p) => p.status.includes("revisión") || p.status.includes("evaluación"));
  else if (activeFilter === "Finalizadas") filtered = closed;

  const rows = filtered.map((p) => [
    `<span class="project-code">${p.code}</span><strong>${esc(p.title)}</strong><br><span class="micro muted">${esc(p.leader || "Investigador")} · ${esc(p.school || "TEC")}</span>`,
    p.type,
    badge(p.status),
    btn("Abrir expediente", "22", "secondary compact", "arrow", `data-proposal="${p.code}"`),
  ]);

  return shell(
    `<div class="grid three mb">${[
      ["Pendientes de revisión", String(pending.length)],
      ["En evaluación / revisión", String(pending.filter((p) => p.status.includes("revisión") || p.status.includes("evaluación")).length)],
      ["Finalizadas en la convocatoria", String(closed.length)],
    ]
      .map(
        ([a, b]) =>
          `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
      )
      .join(
        "",
      )}</div>${tabs(["Pendientes", "En revisión", "Finalizadas"], activeFilter === "Todas" ? "Pendientes" : activeFilter, "data-filter")}<div class="card">${table(["Expediente", "Modalidad", "Etapa", ""], rows.length ? rows : [[`<span class="muted">No hay expedientes para este filtro</span>`, "", "", ""]])}</div>`,
    "Bandeja de trabajo",
    "Expedientes asignados a tu instancia en Fondos VIE 2027.",
    "",
  );
}
function dossier() {
  const code = state.viewProposal || "SI-2027-014";
  const idMap = { "SI-2027-014": 1, "SI-2024-008": 2, "SI-2025-019": 3, "SI-2026-033": 4 };
  const propId = idMap[code] || 1;
  const dbData = apiDossierCache[propId];

  if (!dbData && !apiDossierLoading[propId]) {
    apiDossierLoading[propId] = true;
    apiGet(`/propuestas/${propId}`).then((data) => {
      apiDossierLoading[propId] = false;
      if (data) {
        apiDossierCache[propId] = data;
        if (current === "22") render();
      }
    });
  }

  const p = (apiProposalsCache || top3propuestasmasrecientes || []).find((x) => x.code === code) || {
    code: code,
    title: dbData?.titulo || "Agua Inteligente: monitoreo de cuencas",
    type: dbData?.nombre_modalidad || "Desarrollo tecnológico",
    period: dbData?.fecha_creacion?.slice(0, 4) ? `${dbData.fecha_creacion.slice(0, 4)}–${Number(dbData.fecha_creacion.slice(0, 4)) + 2}` : "2027–2028",
    status: dbData?.nombre_estado || state.stage,
    amount: dbData?.monto_total || 9400000,
  };
  const isClosed = p.status === "Cerrada" || p.status === "Rechazada";
  const historical = code !== "SI-2027-014";

  let body;
  if (dossierTab === "Resumen")
    body = `${definition([
      ["Coordinadora / Líder", dbData?.nombre_lider || "Dra. Laura Méndez"],
      ["Instancia", dbData?.nombre_escuela || "Escuela de Ingeniería Ambiental"],
      ["Período", p.period],
      ["Monto solicitado", money(p.amount)],
      ["Modalidad", p.type],
      ["Línea de investigación", dbData?.nombre_linea || "Gestión integrada del recurso hídrico"],
    ])}<div class="mt"><h3>Resumen de la investigación</h3><p class="small muted" style="margin-top:10px">${esc(dbData?.resumen || (historical ? "Estudio sobre el recurso hídrico con resultados conservados en el expediente." : screen("08").fields.find((f) => f.label === "Resumen").value))}</p></div><div class="mt">${notice(isClosed ? "Consulta de expediente cerrado o resuelto" : "Expediente digital sincronizado con PostgreSQL", isClosed ? "La información se conserva para consulta. No se pueden modificar documentos ni decisiones." : "Propuesta, equipo, plan, presupuesto y decisiones conservan su versión y responsable con trazabilidad en base de datos.")}</div>`;
  else if (dossierTab === "Documentos")
    body =
      doc("Formulario de propuesta.pdf") +
      doc("Plan y riesgos.xlsx") +
      doc("Presupuesto.xlsx") +
      doc("Dictamen de Vinculación.pdf") +
      doc("Acuerdo de aval.pdf");
  else if (dossierTab === "Evaluaciones") {
    if (dbData && dbData.evaluaciones && dbData.evaluaciones.length > 0) {
      body = table(
        ["Instancia", "Evaluador/a", "Resultado", "Observaciones"],
        dbData.evaluaciones.map((ev) => [
          `<strong>${esc(ev.rol_evaluador)}</strong>`,
          esc(ev.evaluador),
          ev.puntaje !== null ? `<strong>${ev.puntaje} / 100</strong>` : (ev.resolucion_cie ? badge(ev.resolucion_cie) : "Dictamen emitido"),
          esc(ev.observaciones || "Conforme a requisitos"),
        ]),
      );
    } else {
      body = `${table(
        ["Instancia", "Resultado", "Documento"],
        [
          ["Vinculación", "Dictamen técnico registrado", act("Ver dictamen", "preview", "text")],
          ["Comité Técnico", "Recomendada", act("Ver rúbrica", "rubric-summary", "text")],
          ["Consejo de Escuela", "Aval otorgado", act("Ver acuerdo", "preview", "text")],
        ],
      )}`;
    }
  } else if (dossierTab === "Resolución")
    body = `${notice(isClosed ? "Resolución y cierre registrados" : "Decisión del CIE", isClosed ? "Acuerdo favorable y certificación de cierre conservados en PostgreSQL." : "La resolución se agrega cuando el CIE concluye su revisión.")}${doc("Acuerdo CIE.pdf")}${isClosed ? doc("Certificación de cierre.pdf") : ""}`;
  else {
    if (dbData && dbData.historial && dbData.historial.length > 0) {
      body = `<div class="timeline">${dbData.historial
        .map(
          (h) =>
            `<div class="event"><small>${new Date(h.fecha_cambio).toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" })}</small><h3>${esc(h.estado_nuevo)}</h3><p><strong>Responsable:</strong> ${esc(h.responsable || "Sistema")}</p><p class="small muted">${esc(h.observaciones || "")}</p></div>`,
        )
        .join("")}</div>`;
    } else {
      body = historyContent();
    }
  }

  return shell(
    `<div class="card card-pad mb"><span class="project-code">${p.code} · ${p.type}</span><div class="section-head" style="margin:10px 0 0"><h2 style="font-size:26px">${p.title}</h2>${badge(historical ? p.status : state.stage, "solid")}</div></div>${tabs(["Resumen", "Documentos", "Evaluaciones", "Resolución", "Historial"], dossierTab)}<div class="two-col">${card("", body)}<div class="stack">${card("Acción disponible", historical ? `<p class="small muted mb">Este expediente está disponible en modo consulta.</p>${btn("Volver a resultados", "30", "secondary")}` : state.role === "investigador" ? `<p class="small muted mb">Consulta la etapa y las acciones pendientes de tu propuesta.</p>${btn("Ver seguimiento", "20", "", "arrow")}` : `<p class="small muted mb">Actúas como ${roles[state.role].label}.</p>${btn("Iniciar revisión", roles[state.role].screen, "", "arrow")}`)}${card("Trazabilidad", `<p class="small muted mb">Cada decisión conserva fecha, actor, documento y versión en PostgreSQL.</p>${btn("Ver historial completo", "28", "text", "arrow")}`)}${["direccion", "cie"].includes(state.role) ? notice("Verificación restringida", "Responsabilidades institucionales: al día.") : ""}</div></div>`,
    "Expediente de propuesta",
    "Toda la información y las decisiones en un mismo lugar.",
    btn(
      "Volver",
      state.role === "investigador" ? "06" : "21",
      "secondary",
      "back",
    ),
  );
}
const criterionGroups = [
  [
    "Equipo",
    [
      ["Composición disciplinaria", 3],
      ["Experiencia", 3],
      ["Articulación del equipo", 3],
      ["Vinculación externa", 2],
      ["Trayectoria de coordinación", 2],
      ["Participación estudiantil", 2, true],
    ],
  ],
  [
    "Fundamentación",
    [
      ["Definición del problema", 4],
      ["Coherencia de objetivos", 4],
      ["Diagnóstico y vacío de conocimiento", 4, true],
    ],
  ],
  [
    "Metodología",
    [
      ["Rigor del desarrollo", 8, true],
      ["Usuarios y validación", 7, true],
    ],
  ],
  [
    "Plan de acción",
    [
      ["Claridad de actividades y responsables", 4, true],
      ["Giras y actividades académicas", 4, true],
      ["Trazabilidad y plazos", 5, true],
    ],
  ],
  [
    "Presupuesto",
    [
      ["Coherencia y topes", 4, true],
      ["Equipamiento en primer año", 4, true],
      ["Otros fondos", 2],
    ],
  ],
  [
    "Riesgos",
    [
      ["Identificación por actividad", 4, true],
      ["Viabilidad de mitigación", 4, true],
    ],
  ],
  [
    "Ética y PI",
    [
      ["Declaración ética", 4, true],
      ["Gestión de propiedad intelectual", 6, true],
    ],
  ],
  [
    "Pertinencia e impacto",
    [
      ["Contribución e impacto", 10],
      ["Innovación", 7],
    ],
  ],
];
const scoreValue = (name) =>
  state.scores[name] ??
  (name === "Contribución e impacto" ||
  name === "Rigor del desarrollo" ||
  name === "Gestión de propiedad intelectual"
    ? 10
    : 8);
function scoreResult() {
  let sum = 0,
    blocked = false;
  for (const [g, cs] of criterionGroups)
    for (const [name, w, mandatory] of cs) {
      const val = Number(scoreValue(name));
      sum += (w * val) / 10;
      if (mandatory && val < 8) blocked = true;
    }
  return {
    sum: Math.round(sum * 10) / 10,
    recommended: sum >= 70 && !blocked && !state.notRecommended,
    blocked,
  };
}
function evaluation(id) {
  const names = {
    23: "Revisión de Vinculación",
    24: "Evaluación técnica",
    25: "Aval del Consejo de Escuela",
    26: "Dictamen de Dirección",
    27: "Resolución del CIE",
  };
  let inner = "";
  if (id === "23")
    inner = `${notice("Dictamen requerido", "Desarrollo tecnológico y potencial de PI identificado en software.")}<div class="mt">${field("Potencial identificado", "Software de integración y registro de mediciones.", "textarea", "", true)}${field("Valoración técnica", "Se identifica potencial de protección en el software. Documentar autoría y resultados, y coordinar divulgación con Vinculación.", "textarea", "", true)}${field("Oficio del dictamen", "CV-014-2026", "text", "27 ago 2026.", true)}${doc("Dictamen técnico de Vinculación.pdf")}</div>`;
  if (id === "24") {
    const sc = scoreResult();
    inner = `${notice("Rúbrica oficial · Desarrollo tecnológico", "Deficiente 0 · Regular 6 · Bueno 8 · Excelente 10. Un obligatorio con 0 o 6 impide recomendar, aun con nota ≥70.")}<div class="mt">${criterionGroups
      .map(
        ([g, cs], i) =>
          `<details class="accordion" ${i < 2 ? "open" : ""}><summary>${g} <span class="muted small">· ${cs.reduce((a, c) => a + c[1], 0)}%</span></summary>${table(
            ["Criterio", "Peso", "Nivel"],
            cs.map(([n, w, m]) => [
              `<strong>${n}</strong>${m ? '<br><span class="micro">Obligatorio</span>' : ""}`,
              w + "%",
              `<select data-score="${esc(n)}" aria-label="Nivel: ${esc(n)}" style="padding:8px;border:1px solid var(--line);border-radius:6px">${[
                [0, "Deficiente"],
                [6, "Regular"],
                [8, "Bueno"],
                [10, "Excelente"],
              ]
                .map(
                  ([v, l]) =>
                    `<option value="${v}" ${v === Number(scoreValue(n)) ? "selected" : ""}>${l} · ${v}</option>`,
                )
                .join("")}</select>`,
            ]),
          )}</details>`,
      )
      .join(
        "",
      )}</div><label class="checkline"><input type="checkbox" id="products-ok" ${!state.notRecommended ? "checked" : ""}>Producción no sumativa conforme: software + artículo WoS/Scopus + manual técnico para 16 h.</label>${field("Justificación de criterios obligatorios", "La propuesta identifica responsables, plazos, beca, riesgos y declaración ética; consta dictamen de Vinculación.", "textarea", "Justifica los criterios obligatorios con referencia a la evidencia.", true)}<div id="score-result" class="notice ${sc.recommended ? "" : "warning"}"><div><strong>${sc.sum.toFixed(1)} / 100 · ${sc.recommended ? "Recomendada" : "No recomendada"}</strong><p>${sc.blocked ? "Hay un criterio obligatorio con nivel insuficiente." : "La recomendación depende de la nota y de los requisitos obligatorios."}</p></div></div>`;
  }
  if (id === "25")
    inner = `${notice("El aval no somete automáticamente", "Después del acuerdo, el investigador realiza el sometimiento formal ante VIE.")}<div class="mt">${field("Instancia", ["Escuela de Ingeniería Ambiental · Coordinadora", "Escuela de Ingeniería Electrónica · Participante"], "select", "Cada consejo avala a su propio personal.", true)}<div class="field-row">${field("Sesión y artículo", "18-2026 · Artículo 4", "text", "", true)}${field("Fecha del acuerdo", "2026-09-17", "date", "", true)}</div>${field("Oficio", "IA-AVAL-014-2026", "text", "", true)}${["Aval de la propuesta y presupuesto de ₡9.400.000", "Participación y horas del personal de la instancia", "Ratificación de la calificación del Comité Técnico"].map((t) => `<label class="checkline"><input type="checkbox" checked required>${t}</label>`).join("")}${doc("Acuerdo firmado de la coordinadora.pdf")}${doc("Acuerdo firmado de instancia participante.pdf")}</div>`;
  if (id === "26")
    inner = `${notice("Propuesta sometida el 28 sep 2026", "La Dirección verifica el expediente antes de emitir el dictamen para CIE.")}<div class="mt">${["Responsabilidades institucionales al día", "Riesgos por actividad y mitigación coherente", "Participación estudiantil presupuestada", "Declaración ética y permisos verificados", "Documentos, evaluación y acuerdos completos"].map((t) => `<label class="checkline"><input type="checkbox" checked required>${t}</label>`).join("")}</div>${field("Verificación restringida", "Al día", "readonly")}${field("Dictamen", ["Favorable", "Con observaciones", "Desfavorable"], "select", "", true)}${field("Fundamentación", "El expediente incorpora la evaluación, los avales y la documentación requerida. Se remite al CIE para resolución.", "textarea", "09 oct 2026.", true)}${doc("Dictamen DI-014-2026.pdf")}`;
  if (id === "27")
    inner = `${notice("Expediente con dictamen de Dirección", "Valora cumplimiento del proceso, responsabilidades, interés estratégico y disponibilidad de recursos.")}<div class="mt">${field("Resolución", ["Aprobada", "Rechazada", "Con observaciones"], "select", "", true, "resolution")}</div><div class="field-row">${field("Sesión y artículo", "23-2026 · Artículo 5", "text", "", true)}${field("Fecha de resolución", "2026-10-23", "date", "", true)}</div>${field("Fundamentación y condiciones", "La iniciativa es pertinente y cuenta con respaldo en el proceso previo. Se aprueba conforme al plan y presupuesto; debe presentarse carta de aceptación.", "textarea", "La decisión debe quedar motivada, incluidas las resoluciones negativas.", true)}${doc("Acuerdo CIE-014-2026.pdf")}`;
  const actionLabel = {
    23: "Emitir dictamen",
    24: "Registrar evaluación",
    25: "Registrar aval",
    26: "Emitir dictamen de Dirección",
    27: "Registrar resolución",
  }[id];
  return shell(
    `<div class="two-col"><form class="card form-card" id="evaluation-form"><div class="form-title"><h2>${names[id]}</h2>${badge("Pendiente")}</div>${inner}<div class="form-footer">${act("Devolver con observaciones", "return", "secondary")}${act(actionLabel, "decision", "", "check", `data-step="${id}"`)}</div></form><div class="stack">${card(
      "Expediente en revisión",
      `<span class="project-code">SI-2027-014</span><h3>Agua Inteligente: monitoreo de cuencas</h3><p class="small muted" style="margin:10px 0 20px">Laura Méndez<br>Ingeniería Ambiental</p>${definition(
        [
          ["Modalidad", "Desarrollo tecnológico"],
          ["Total", money(9400000)],
          ["Período", "2027–2028"],
          ["Dedicación", "16 h/semana"],
        ],
      )}<div class="mt">${btn("Consultar expediente", "22", "secondary", "folder")}</div>`,
    )}${id === "24" ? card("Resultado ponderado", `<div class="score" id="score-number">${scoreResult().sum.toFixed(1)}<small> / 100</small></div><p class="small muted" style="margin:12px 0">Umbral de recomendación: 70.</p><div class="scorebar"><span style="width:${scoreResult().sum}%"></span></div><p class="micro muted" style="margin-top:16px">La producción y los requisitos obligatorios también deben cumplir.</p>`) : card("Trazabilidad", `<p class="small muted mb">La decisión quedará asociada a la persona, la fecha, el documento y la versión revisada.</p>${btn("Consultar historial", "28", "text", "arrow")}`)}</div></div>`,
    names[id],
    "Revisa la evidencia y registra una decisión motivada.",
  );
}
const events = [
  [
    "21 ago 2026",
    "Envío a Vinculación",
    "Laura Méndez · Investigador",
    "Versión 1.0 registrada.",
  ],
  [
    "27 ago 2026",
    "Dictamen de Vinculación",
    "Mariana Solís · Vinculación",
    "CV-014-2026 · Potencial de software.",
  ],
  [
    "10 sep 2026",
    "Evaluación técnica registrada",
    "Gabriel Sánchez · Comité Técnico",
    "Rúbrica DT · Recomendación favorable.",
  ],
  [
    "17 sep 2026",
    "Avales incorporados",
    "Patricia Vargas · Consejo",
    "Coordinadora y participante · Acuerdos de aval.",
  ],
  [
    "28 sep 2026",
    "Sometimiento formal",
    "Laura Méndez · Investigador",
    "Expediente con evaluación y avales enviado a Dirección.",
  ],
  [
    "09 oct 2026",
    "Dictamen de Dirección",
    "Elena Chacón · Dirección",
    "DI-014-2026 · Favorable.",
  ],
  [
    "23 oct 2026",
    "Resolución CIE",
    "Ricardo Mora · CIE",
    "CIE-014-2026 · Aprobada.",
  ],
  [
    "03 nov 2026",
    "Carta de aceptación",
    "Laura Méndez · Investigador",
    "Carta registrada en el plazo de aceptación.",
  ],
];
function historyContent() {
  return `<div class="timeline">${events.map(([d, t, a, b]) => `<div class="event"><small>${d}</small><h3>${t}</h3><p>${a}</p><p>${b}</p></div>`).join("")}</div>`;
}
function history() {
  return shell(
    `${card("SI-2027-014 · Historial de actuaciones", historyContent())}`,
    "Historial del expediente",
    "Cada cambio conserva su responsable, fecha, versión y evidencia.",
    btn("Volver al expediente", "22", "secondary", "back"),
  );
}
function searchHistory() {
  const escuelasOpts = apiCatalogsCache?.escuelas
    ? ["Todas", ...apiCatalogsCache.escuelas.map((e) => e.nombre)]
    : ["Todas", "Escuela de Ingeniería Ambiental", "Escuela de Ingeniería Electrónica", "Escuela de Computación", "Escuela de Biología", "Escuela de Administración de Empresas"];
  const modalidadesOpts = apiCatalogsCache?.modalidades
    ? ["Todas", ...apiCatalogsCache.modalidades.map((m) => m.nombre_modalidad)]
    : ["Todas", "Investigación básica, aplicada o ambas", "Desarrollo tecnológico", "Actividad de fortalecimiento"];
  const estadosOpts = apiCatalogsCache?.estados
    ? ["Todos", ...apiCatalogsCache.estados.map((s) => s.nombre_estado)]
    : ["Todos", "En formulación", "En ejecución", "Cerrada", "Rechazada"];
  const lineasOpts = apiCatalogsCache?.lineas_investigacion
    ? ["Todas", ...apiCatalogsCache.lineas_investigacion.map((l) => l.nombre_linea)]
    : ["Todas", "Gestión integrada del recurso hídrico", "Inteligencia Artificial y Ciencia de Datos", "Biotecnología y Sostenibilidad Ambiental"];

  return shell(
    `<div class="two-col"><form class="card card-pad" id="history-search"><div class="section-head"><h2>Encuentra un expediente</h2>${badge("Consulta institucional en BD")}</div>${field("Código, título o persona investigadora", state.search, "search", "Puedes combinar la búsqueda con filtros institucionales.", false, "history:query")}<div class="field-row">${field("Escuela", escuelasOpts, "select", "", false, "history:school")}${field("Modalidad", modalidadesOpts, "select", "", false, "history:mode")}</div><div class="field-row">${field("Estado", estadosOpts, "select", "", false, "history:status")}${field("Línea de investigación", lineasOpts, "select", "", false, "history:line")}</div><div class="field-row">${field("Desde", "2024", "number", "", false, "history:from")}${field("Hasta", "2028", "number", "", false, "history:to")}</div><div class="form-footer">${act("Limpiar filtros", "clear-search", "text")}${act("Buscar expedientes", "search-history", "", "search")}</div></form><div class="stack">${card("Consulta con trazabilidad", `<div class="list-item">${icon("folder")}<div><h3>Expediente completo</h3><p>Propuesta, recursos, documentos y productos.</p></div></div><div class="list-item">${icon("shield")}<div><h3>Decisiones y evidencia</h3><p>Evaluaciones, avales, dictámenes y resolución.</p></div></div><div class="list-item">${icon("clock")}<div><h3>Historial conservado</h3><p>Fechas, actores y versiones sincronizadas con PostgreSQL.</p></div></div>`)}</div></div>`,
    "Consulta histórica",
    "Busca iniciativas y recupera la evidencia de su recorrido.",
  );
}
function historyResults() {
  const q = (state.search || "").toLowerCase(),
    list = state.apiSearchResults || apiProposalsCache || top3propuestasmasrecientes || [];
  return shell(
    `<div class="section-head"><span class="result-count">${list.length} expedientes encontrados en base de datos ${q ? "para «" + esc(state.search) + "»" : ""}</span>${btn("Modificar filtros", "29", "secondary", "settings")}</div>${list.length ? `<div class="card">${table(["Expediente", "Período", "Estado", "Monto", ""], projectRows(list), `<span>${list.length} resultado${list.length === 1 ? "" : "s"} desde PostgreSQL</span><span>Página 1 de 1</span>`)}</div>` : `<div class="card empty">${icon("search")}<h2>No encontramos coincidencias</h2><p>Prueba con una palabra más general o elimina un filtro para ampliar los resultados.</p>${act("Limpiar y volver a buscar", "clear-results", "secondary")}</div>`}`,
    "Resultados de consulta",
    "Abre un expediente para consultar sus documentos y decisiones.",
  );
}
function adminCalls() {
  return shell(
    `<div class="card mb">${table(["Convocatoria", "Ejecución", "Estado", ""], [['<strong>Fondos VIE 2027</strong><br><span class="micro muted">Disposiciones y cronograma vigentes</span>', "Desde 01 ene 2027", badge("Configurada"), act("Editar", "admin-call", "secondary compact", "edit")]])}</div><div class="grid two">${card("Cronograma de la convocatoria", table(["Etapa", "Fecha"], calendarRows), act("Editar", "admin-calendar", "text compact"))}${card(
      "Reglas por modalidad",
      table(
        ["Modalidad", "Duración", "Tope"],
        [
          ["Fortalecimiento", "1 año", "₡2M total"],
          ["Básica / aplicada", "2 años", "₡4M/año"],
          ["Desarrollo tecnológico", "3 años", "₡5M/año"],
        ],
      ),
    )}</div>`,
    "Administración de convocatorias",
    "Configura instrumentos, plazos y modalidades desde Dirección/VIE.",
    act("Nueva convocatoria", "admin-call", "secondary", "plus"),
  );
}
function adminCatalogs() {
  const selected = activeFilter === "Todas" ? "Rúbricas" : activeFilter;
  const roleRows = (state.roleOrder || Object.keys(roles))
    .map(
      (key, i) =>
        `<div class="role-order-row"><strong>${i + 1}</strong><div><strong>${roles[key].label}</strong><div class="micro muted">${roles[key].name}</div></div><div class="role-order-actions"><button data-action="role-up" data-role="${key}" aria-label="Subir ${esc(roles[key].label)}" ${i === 0 ? "disabled" : ""}>↑</button><button data-action="role-down" data-role="${key}" aria-label="Bajar ${esc(roles[key].label)}" ${i === (state.roleOrder || []).length - 1 ? "disabled" : ""}>↓</button></div></div>`,
    )
    .join("");
  return shell(
    `${tabs(["Rúbricas", "Escuelas", "Líneas de investigación", "Modalidades", "Roles y permisos"], selected, "data-filter")}${
      selected === "Rúbricas"
        ? `<div class="grid three">${[
            ["Fortalecimiento", "20 · 15 · 15 · 8 · 10 · 7 · 25"],
            ["Básica y aplicada", "20 · 12 · 15 · 13 · 10 · 8 · 7 · 15"],
            ["Desarrollo tecnológico", "15 · 12 · 15 · 13 · 10 · 8 · 10 · 17"],
          ]
            .map(([a, b]) =>
              card(
                a,
                `${badge("Versión 2027")}<p class="small muted" style="margin:18px 0">Escala 0 / 6 / 8 / 10<br>Umbral 70% + obligatorios</p><p class="micro muted mb">Pesos por sección: ${b}</p>${act("Consultar rúbrica", "rubric-summary", "secondary")}`,
              ),
            )
            .join("")}</div>`
        : selected === "Roles y permisos"
          ? `<div class="two-col"><section class="card"><div class="card-pad"><h2>Orden de roles</h2><p class="small muted">Este orden se usa en el selector de perfiles del prototipo.</p></div><div class="role-order">${roleRows}</div></section>${card("Criterio de orden", `<p class="small muted">La superadministración puede priorizar la ruta operativa: proponente, revisiones, aval, dictamen y resolución.</p>${notice("Cambio reversible", "Usa las flechas para ajustar el orden. Los permisos de cada rol no cambian.")}`)}</div>`
          : `<div class="card">${table(
              ["Nombre", "Estado", ""],
              (selected === "Escuelas"
                ? (apiCatalogsCache?.escuelas?.map((e) => e.nombre) || [
                    "Escuela de Ingeniería Ambiental",
                    "Escuela de Ingeniería Electrónica",
                  ])
                : selected === "Modalidades"
                  ? (apiCatalogsCache?.modalidades?.map((m) => m.nombre_modalidad) || [
                      "Actividad de fortalecimiento",
                      "Investigación básica",
                      "Investigación aplicada",
                      "Desarrollo tecnológico",
                    ])
                  : (apiCatalogsCache?.lineas_investigacion?.map((l) => l.nombre_linea) || [
                      "Gestión integrada del recurso hídrico",
                      "Tecnologías de monitoreo ambiental",
                    ])
              ).map((x) => [
                x,
                badge("Activo"),
                act(
                  "Editar",
                  "catalog-edit",
                  "text compact",
                  "edit",
                  `data-value="${esc(x)}"`,
                ),
              ]),
            )}</div>`
    }<div class="mt">${notice("Conserva la versión de cada instrumento", "Una propuesta evaluada mantiene la rúbrica aplicada. Los cambios posteriores se registran para nuevas versiones de convocatoria.")}</div>`,
    "Rúbricas, catálogos y roles",
    "Parámetros de soporte administrados por la superadministración de Dirección/VIE.",
    selected === "Roles y permisos"
      ? ""
      : act("Agregar entrada", "catalog-edit", "secondary", "plus"),
  );
}
function profile() {
  const p = person();
  return shell(
    `<div class="card card-pad" style="max-width:760px"><div class="action-row mb"><span class="avatar" style="width:60px;height:60px;font-size:20px">${esc(p.initials)}</span><div><h2>${esc(p.name)}</h2><span class="small muted">${p.label}</span></div></div>${definition(
      [
        [
          "Correo",
          esc(session ? session.user.correo : "cuenta.demo@example.com"),
        ],
        ["Rol activo", p.label],
        ["Tema", state.theme === "dark" ? "Oscuro" : "Claro"],
      ],
    )}<div class="action-row mt">${act("Ajustes y accesibilidad", "settings", "secondary", "settings")}${act("Contactar soporte", "contact", "text", "info")}</div></div><details class="accordion" style="max-width:760px;margin-top:28px"><summary>Opciones del prototipo</summary><div class="action-row mt">${act("Cambiar rol", "roles", "secondary", "user")}${act("Guía de recorridos", "guide", "text")}${act("Ver etapas", "stages", "text")}</div><p class="small muted mt">Los datos, documentos y decisiones son ejemplos para evaluar la interfaz.</p></details>`,
    "Mi perfil",
  );
}
function guardRoute(id) {
  const roleByScreen = {
    23: "vinculacion",
    24: "comite",
    25: "consejo",
    26: "direccion",
    27: "cie",
  };
  if (roleByScreen[id] && state.role !== roleByScreen[id]) return false;
  if (["29", "30"].includes(id) && !["direccion", "cie"].includes(state.role))
    return false;
  if (["31", "32"].includes(id) && state.role !== "direccion") return false;
  if (+id >= 4 && +id <= 20 && state.role !== "investigador") return false;
  if (id === "21" && state.role === "investigador") return false;
  return true;
}
function render() {
  document.documentElement.dataset.theme = state.theme || "light";
  document.documentElement.classList.toggle("large-text", !!state.largeText);
  current = (location.hash.slice(1) || "01").split("?")[0];
  if (!screen(current)) current = "01";
  // Guarda de sesión: sin sesión solo existe el login; con sesión, el login redirige al inicio del rol.
  if (!session && current !== "01") {
    location.hash = "01";
    return;
  }
  if (session && current === "01") {
    go(homeFor());
    return;
  }
  if (!guardRoute(current)) {
    $("#app").innerHTML = shell(
      card(
        "Este recorrido corresponde a otro rol",
        `<p class="small muted mb">Cambia al perfil institucional indicado para explorar sus acciones de demostración.</p>${act("Elegir rol", "roles", "secondary")}`,
      ),
      "Acceso por rol",
      "Las acciones se separan según la arquitectura de información.",
    );
    return;
  }
  const simple = {
    "01": login,
    "02": dashboard,
    "03": notifications,
    "04": calls,
    "05": callDetail,
    "06": myProposals,
    "07": newProposal,
    19: confirmation,
    20: tracking,
    21: inbox,
    22: dossier,
    28: history,
    29: searchHistory,
    30: historyResults,
    31: adminCalls,
    32: adminCatalogs,
    33: profile,
  };
  let html;
  if (simple[current]) html = simple[current]();
  else if (+current >= 8 && +current <= 18) {
    const forms = {
      "08": dataForm,
      "09": teamForm,
      10: foundationForm,
      11: objectiveForm,
      12: methodologyForm,
      13: planForm,
      14: riskForm,
      15: budgetForm,
      16: complementaryForm,
      17: documentsForm,
      18: reviewForm,
    };
    html = shell(
      formShell(forms[current]()),
      "Agua Inteligente",
      "SI-2027-014",
      btn("Salir del formulario", "06", "secondary"),
    );
  } else html = evaluation(current);
  $("#app").innerHTML = html;
  document.title = (screen(current)?.title || "SGPI") + " · SGPI";
  window.scrollTo(0, 0);
}
function go(id) {
  closeModal();
  userMenuOpen = false;
  activeFilter = "Todas";
  if (id !== "22") dossierTab = "Resumen";
  if (location.hash === "#" + id) render();
  else location.hash = id;
}
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => (el.style.display = "none"), 4200);
}
function closeModal() {
  const root = $("#modal-root");
  root.innerHTML = "";
  document.body.style.overflow = "";
  modalName = null;
  if (previousFocus?.isConnected) previousFocus.focus();
}
function modal(title, body, actions = "", wide = false, name = "dialog") {
  previousFocus = document.activeElement;
  modalName = name;
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop" data-backdrop><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal="${name}"><header class="modal-head"><h2 id="modal-title">${title}</h2><button data-action="close" aria-label="Cerrar">${icon("close")}</button></header>${body}${actions ? `<div class="actions">${actions}</div>` : ""}</section></div>`;
  document.body.style.overflow = "hidden";
  $(".modal button,.modal input,.modal select")?.focus();
}
function validate(formId) {
  const form = $(formId);
  if (!form) return true;
  let valid = true;
  $$("[required]", form).forEach((el) => {
    const ok =
      el.type === "checkbox"
        ? el.checked
        : el.value.trim() !== "" && (el.type !== "email" || el.validity.valid);
    const f = el.closest(".field");
    if (f) {
      f.classList.toggle("error", !ok);
      $(".error-msg", f).hidden = ok;
    }
    if (!ok) valid = false;
  });
  if (!valid) {
    $(
      ".field.error input,.field.error textarea,.field.error select",
      form,
    )?.focus();
    toast("Revisa los campos obligatorios indicados.");
  }
  return valid;
}
function modalRoles() {
  const ordered = (state.roleOrder || Object.keys(roles)).filter(
    (k) => roles[k],
  );
  modal(
    "Cambiar rol",
    `<p class="mb">Selecciona el perfil de trabajo. El orden lo administra Dirección/VIE.</p>${ordered
      .map((k) => {
        const r = roles[k];
        return `<button class="role-option" data-action="set-role" data-role="${k}"><span class="avatar">${r.initials}</span><span style="flex:1"><strong>${r.label}</strong><small>${r.name}</small></span>${icon("arrow")}</button>`;
      })
      .join("")}`,
    "",
    false,
    "roles",
  );
}
const confirmBtn = (label, action, extra = "") =>
  act(label, action, "", "check", extra);
async function doLogin() {
  const box = $("#login-error");
  if (box) box.innerHTML = "";
  if (!validate("#login-form")) return;
  const emailEl = $('[data-field="login:email"]'),
    pwEl = $('[data-field="login:password"]'),
    b = $('#login-form [data-action="login"]');
  const correo = emailEl.value.trim().toLowerCase(),
    password = pwEl.value;
  b.disabled = true;
  b.lastChild.textContent = "Ingresando…";
  try {
    const user = await apiLogin(correo, password);
    const key =
      user && Array.isArray(user.roles) && user.roles.length
        ? ROLE_KEYS[user.roles[0]]
        : null;
    if (!key) throw new AuthError("noroles");
    setSession({ user });
    applyRole(key);
    await Promise.all([numsPropuestas(), propuestaMasReciente(), top3PropuestasMasRecientes(), Notificaciones()]);
    save();
    go(homeFor());
  } catch (err) {
    if (box?.isConnected)
      box.innerHTML = notice(
        "No fue posible ingresar",
        LOGIN_ERRORS[err instanceof AuthError ? err.code : "server"],
        "warning",
      );
    if (pwEl?.isConnected) {
      pwEl.value = "";
      pwEl.focus();
    }
    if (b.isConnected) {
      b.disabled = false;
      b.lastChild.textContent = "Ingresar";
    }
  }
}
async function handleAction(action, el) {
  switch (action) {
    case "close":
      closeModal();
      break;
    case "roles":
      userMenuOpen = false;
      modalRoles();
      break;
    case "user-menu":
      userMenuOpen = !userMenuOpen;
      render();
      break;
    case "settings":
      userMenuOpen = false;
      modal(
        "Ajustes y accesibilidad",
        `<div class="setting-row"><div><strong>Modo oscuro</strong><p class="small muted">Reduce el brillo y aumenta el contraste en ambientes con poca luz.</p></div>${act(state.theme === "dark" ? "Desactivar" : "Activar", "toggle-theme", "secondary", "", `aria-pressed="${state.theme === "dark"}"`)}</div><div class="setting-row"><div><strong>Texto ampliado</strong><p class="small muted">Aumenta el tamaño general de lectura.</p></div>${act(state.largeText ? "Restablecer" : "Aumentar", "toggle-text", "secondary", "", `aria-pressed="${state.largeText}"`)}</div>`,
        act("Cerrar", "close"),
        false,
        "settings",
      );
      break;
    case "toggle-theme":
      state.theme = state.theme === "dark" ? "light" : "dark";
      save();
      document.documentElement.dataset.theme = state.theme;
      closeModal();
      render();
      toast(`Modo ${state.theme === "dark" ? "oscuro" : "claro"} activado.`);
      break;
    case "toggle-text":
      state.largeText = !state.largeText;
      save();
      closeModal();
      render();
      toast(
        state.largeText
          ? "Texto ampliado activado."
          : "Tamaño de texto restablecido.",
      );
      break;
    case "contact":
      userMenuOpen = false;
      modal(
        "Contacto y soporte",
        `<div class="action-row mb"><span class="avatar">AS</span><div><strong>Andrea Solano</strong><div class="small muted">Gestora de apoyo SGPI · contacto de demostración</div></div></div>${definition(
          [
            [
              "Correo",
              '<a href="mailto:contacto.sgpi@example.com">contacto.sgpi@example.com</a>',
            ],
            ["Horario", "Lunes a viernes · 8:00 a 16:30"],
            ["Canal", "Mesa de apoyo VIE"],
          ],
        )}<div class="mt">${notice("Dato para la maqueta", "Sustituye este contacto por la persona y el canal institucionales antes de publicar el sistema.")}</div>`,
        act("Cerrar", "close"),
        false,
        "contact",
      );
      break;
    case "logout":
      userMenuOpen = false;
      setSession(null);
      go("01");
      toast("Sesión cerrada.");
      break;
    case "set-role":
      applyRole(el.dataset.role);
      save();
      go(state.role === "investigador" ? "02" : "21");
      break;
    case "login":
      await doLogin();
      break;
    case "login-help":
      modal(
        "Ayuda para iniciar sesión",
        "<p>Usa tu correo institucional y la contraseña asignada a tu cuenta.</p><p>Si olvidaste tus credenciales o tu usuario está inactivo, contacta a la mesa de apoyo indicada en esta pantalla.</p>",
        act("Contactar soporte", "contact", "secondary") +
          act("Entendido", "close"),
      );
      break;
    case "account-help":
      modal(
        "Ayuda para crear una cuenta",
        `<div class="timeline"><div class="event current"><h3>1. Verifica tu vínculo institucional</h3><p>La cuenta debe asociarse a una persona o instancia autorizada.</p></div><div class="event"><h3>2. Solicita acceso</h3><p>Contacta a la mesa de apoyo VIE e indica el rol requerido.</p></div><div class="event"><h3>3. Confirma la activación</h3><p>Recibirás las instrucciones institucionales para el primer ingreso.</p></div></div>${notice("Prototipo sin registro real", "Esta maqueta no crea cuentas ni envía datos.")}`,
        act("Contactar soporte", "contact", "secondary") +
          act("Cerrar", "close"),
        false,
        "account-help",
      );
      break;
    case "role-up":
    case "role-down": {
      const order = [...(state.roleOrder || Object.keys(roles))],
        i = order.indexOf(el.dataset.role),
        j = action === "role-up" ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < order.length) {
        [order[i], order[j]] = [order[j], order[i]];
        state.roleOrder = order;
        save();
        render();
        toast("Orden de roles actualizado.");
      }
      break;
    }
    case "save":
      save();
      toast("Borrador guardado en este navegador.");
      break;
    case "next":
      if (validate("#proposal-form")) {
        if (current === "15" && !budgetValid()) {
          toast("Corrige el presupuesto antes de continuar.");
          break;
        }
        save();
        go(el.dataset.next);
      }
      break;
    case "create-proposal":
      state.mode = $("input[name=modality]:checked")?.value || state.mode;
      if (state.mode !== "Desarrollo tecnológico") {
        modal(
          "Modalidad seleccionada",
          `<p>${esc(state.mode)}</p>${notice("Alcance de la demostración", state.mode === "Actividad de fortalecimiento" ? "Se dispone de disposiciones y rúbrica, pero no del formulario original de fortalecimiento en los archivos recibidos. El recorrido completo utiliza desarrollo tecnológico." : "El caso de demostración completo utiliza desarrollo tecnológico; básica/aplicada permite hasta 2 años y ₡4 millones por año.")}`,
          act("Volver", "close", "secondary") +
            act("Abrir caso de desarrollo tecnológico", "demo-project"),
        );
      } else {
        state.stage = "En formulación";
        save();
        go("08");
      }
      break;
    case "demo-project":
      state.mode = "Desarrollo tecnológico";
      state.stage = "En formulación";
      save();
      go("08");
      break;
    case "read":
      state.read = true;
      save();
      render();
      toast("Todas las notificaciones están marcadas como leídas.");
      break;
    case "all-notifications":
      activeFilter = "Todas";
      render();
      break;
    case "calendar":
      modal(
        "Calendario · Fondos VIE 2027",
        table(["Etapa", "Fecha"], calendarRows),
        act("Cerrar", "close"),
        true,
        "calendar",
      );
      break;
    case "filter-calls":
      if (
        (state.saved["call:query"] || "").trim() &&
        !/vie|2027|fondo/i.test(state.saved["call:query"])
      )
        toast("No hay coincidencias. Prueba con «VIE» o «2027».");
      else toast("1 convocatoria encontrada: Fondos VIE 2027.");
      break;
    case "preview":
      modal(
        "Vista previa de documento",
        `<span class="badge">Documento ficticio</span><h3 style="margin-top:22px">${esc(el.dataset.doc || "Documento del expediente")}</h3><p>Expediente SI-2027-014 · Agua Inteligente: monitoreo de cuencas.</p><div class="notice mt">${icon("file")}<div><strong>Representación del visor</strong><p>Esta pantalla muestra el acceso y la trazabilidad del archivo. No representa un documento oficial firmado.</p></div></div>`,
        act("Cerrar visor", "close", "secondary"),
        false,
        "document",
      );
      break;
    case "team":
      modal(
        "Participante del equipo",
        `${field("Nombre completo", "María Arias", "text", "", true, "modal:person")}${field("Institución / instancia", "Entidad colaboradora", "text", "", true, "modal:institution")}<div class="field-row">${field("Rol", ["Colaboración externa", "Investigador"], "select", "", false, "modal:role")}${field("Dedicación", "4", "number", "Horas por semana.", false, "modal:hours")}</div>${field("ORCID", "Pendiente", "text", "Identificador ORCID del participante.", false, "modal:orcid")}${field("Responsabilidad", "Participa en la validación de campo.", "textarea", "Adjuntar carta de compromiso si es externo.", true, "modal:responsibility")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar participante", "team-save"),
        false,
        "team",
      );
      break;
    case "team-save":
      state.teamAdded = true;
      state.extraPerson = $('[data-field="modal:person"]').value;
      save();
      closeModal();
      render();
      toast("Participación externa registrada.");
      break;
    case "objective":
      modal(
        "Agregar objetivo específico",
        field(
          "Objetivo",
          "Documentar la transferencia de resultados a las personas usuarias.",
          "textarea",
          "Se asociará con actividades del plan.",
          true,
          "modal:objective",
        ),
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar objetivo", "save-extra", 'data-kind="objective"'),
      );
      break;
    case "activity":
      modal(
        "Agregar actividad",
        `${field("Objetivo específico", ["OE1", "OE2", "OE3"], "select", "", true, "modal:objective-code")}${field("Actividad", "Entregar informe semestral de avance", "text", "", true, "modal:activity")}${field("Resultado esperado", "Informe semestral registrado", "text", "", true, "modal:result")}<div class="field-row">${field("Responsable", "Laura Méndez", "text", "Ejecuta / Supervisa / Participa.", true, "modal:owner")}${field("Mes inicial / duración", "6 / 1", "text", "Meses correlativos.", true, "modal:period")}</div>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar actividad", "save-extra", 'data-kind="activity"'),
        false,
        "activity",
      );
      break;
    case "risk":
      modal(
        "Agregar riesgo",
        `${field("Actividad", ["Definir requerimientos", "Integrar y calibrar", "Validar en campo", "Evaluar y documentar"], "select", "", true, "modal:riskactivity")}${field("Riesgo", "Indisponibilidad temporal de un sitio piloto.", "textarea", "", true, "modal:risk")}${field("Mitigación", "Acordar un sitio alternativo antes del inicio de la validación.", "textarea", "", true, "modal:mitigation")}${field("Responsable", "Sofía Vega", "text", "", true, "modal:riskowner")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar riesgo", "save-extra", 'data-kind="risk"'),
        false,
        "risk",
      );
      break;
    case "save-extra": {
      const kind = el.dataset.kind;
      if (kind === "objective")
        state.extraObjective = $('[data-field="modal:objective"]').value;
      if (kind === "activity") {
        const a = [
          $('[data-field="modal:objective-code"]').value,
          $('[data-field="modal:activity"]').value,
          $('[data-field="modal:result"]').value,
          $('[data-field="modal:owner"]').value,
          $('[data-field="modal:period"]').value,
        ];
        state.extraActivities = (state.extraActivities || []).concat([a]);
      }
      if (kind === "risk") {
        const r = [
          $('[data-field="modal:riskactivity"]').value,
          $('[data-field="modal:risk"]').value,
          $('[data-field="modal:mitigation"]').value,
          $('[data-field="modal:riskowner"]').value,
        ];
        state.extraRisks = (state.extraRisks || []).concat([r]);
      }
      save();
      closeModal();
      render();
      toast("Registro guardado e incorporado a la propuesta.");
      break;
    }
    case "budget-edit": {
      const i = Number(el.dataset.index),
        r = state.budget[i];
      for (const k of [
        "modal:budget-a",
        "modal:budget-b",
        "modal:budget-detail",
      ])
        delete state.saved[k];
      modal(
        "Editar rubro",
        `<p class="mb">${r.code} · ${r.name}</p><div class="field-row">${field("Monto 2027", r.a, "number", "En colones.", true, "modal:budget-a")}${field("Monto 2028", r.b, "number", "En colones.", true, "modal:budget-b")}</div>${field("Justificación", r.detail, "textarea", "Relaciona el gasto con el plan.", true, "modal:budget-detail")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar rubro", "budget-save", `data-index="${i}"`),
        false,
        "budget",
      );
      break;
    }
    case "budget-save": {
      const i = Number(el.dataset.index),
        a = Number($('[data-field="modal:budget-a"]').value),
        b = Number($('[data-field="modal:budget-b"]').value);
      if (a < 0 || b < 0) {
        toast("Los montos deben ser iguales o mayores a cero.");
        break;
      }
      state.budget[i] = {
        ...state.budget[i],
        a,
        b,
        detail: $('[data-field="modal:budget-detail"]').value,
      };
      delete state.saved["modal:budget-a"];
      delete state.saved["modal:budget-b"];
      delete state.saved["modal:budget-detail"];
      save();
      closeModal();
      render();
      toast(
        budgetValid()
          ? "Rubro actualizado y totales recalculados."
          : "Rubro guardado. Revisa las validaciones del presupuesto.",
      );
      break;
    }
    case "budget-add":
      modal(
        "Agregar rubro",
        `${field("Objeto de gasto", ["1-05-02-01 · Viáticos dentro del país"], "select", "", true, "modal:new-budget")}${field("Monto 2027", "0", "number", "", true, "modal:new-a")}${field("Monto 2028", "0", "number", "", true, "modal:new-b")}${field("Justificación", "Giras previstas en el plan de acción.", "textarea", "", true, "modal:new-detail")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar rubro", "budget-add-save"),
      );
      break;
    case "budget-add-save":
      state.budget.push({
        name: "Viáticos dentro del país",
        code: "1-05-02-01",
        a: Number($('[data-field="modal:new-a"]').value),
        b: Number($('[data-field="modal:new-b"]').value),
        detail: $('[data-field="modal:new-detail"]').value,
      });
      save();
      closeModal();
      render();
      break;
    case "budget-rules":
      modal(
        "Reglas de presupuesto",
        `<div class="stack">${notice("Tope anual DT: ₡5.000.000", "La propuesta distribuye ₡4.800.000 en 2027 y ₡4.600.000 en 2028.")}${notice("Bienes duraderos y licencias en año 1", "Una excepción requiere justificación aprobada por CIE.")}${notice("Beca obligatoria de al menos 10 h/semana", "Tarifa del instrumento: ₡2.400/h. Máximo 10 meses/año. El caso planifica 400 horas/año.")}${notice("Servicios profesionales externos", "Solo tareas puntuales justificadas, hasta 30% del presupuesto operativo. El transporte institucional no se presupuesta.")}</div>`,
        act("Entendido", "close"),
        false,
        "budget-rules",
      );
      break;
    case "upload":
      modal(
        "Adjuntar documento",
        `<div class="mt">${field("Documento", ["Fundamentación.pdf", "Carta de compromiso.pdf", "Acuerdo firmado.pdf"], "select", "", false, "modal:upload")}</div>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Adjuntar", "upload-save"),
        false,
        "upload",
      );
      break;
    case "upload-save":
      state.attachments = 4;
      save();
      closeModal();
      render();
      toast("Documento adjunto · versión 1.0.");
      break;
    case "toggle-attachment":
      state.attachments = state.attachments >= 4 ? 3 : 4;
      save();
      render();
      break;
    case "send":
      if (!budgetValid() || state.attachments < 4) {
        modal(
          "Corrige la propuesta antes de enviar",
          notice(
            "Hay requisitos incompletos",
            !budgetValid()
              ? "Revisa los topes y las reglas del presupuesto."
              : "Falta el anexo obligatorio de fundamentación.",
            "warning",
          ),
          btn("Ir a corregir", !budgetValid() ? "15" : "17"),
        );
        break;
      }
      if (!$("#reviewed")?.checked) {
        toast("Confirma que revisaste la información antes de enviar.");
        $("#reviewed")?.focus();
        break;
      }
      modal(
        "¿Enviar a revisión de Vinculación?",
        `<p>Se registrará la versión 1.0 de <strong>Agua Inteligente: monitoreo de cuencas</strong> y quedará disponible para la instancia revisora.</p><div class="mt">${notice("Todavía no es el sometimiento formal", "El sometimiento ante VIE ocurre después de la evaluación técnica y los avales.")}</div>`,
        act("Seguir revisando", "close", "secondary") +
          confirmBtn("Confirmar envío", "send-confirm"),
        false,
        "send",
      );
      break;
    case "send-confirm":
      state.stage = "En revisión de Vinculación";
      save();
      (async () => {
        try {
          await apiPatch("/propuestas/1/estado", {
            id_estado_nuevo: 2,
            id_usuario_responsable: session?.user?.id_usuario || 1,
            observaciones: "Envío inicial a revisión del Centro de Vinculación",
          });
          delete apiDossierCache[1];
          loadApiProposals();
        } catch (e) {
          console.warn("Error al sincronizar con PostgreSQL:", e);
        }
      })();
      go("19");
      break;
    case "submit":
      modal(
        "Sometimiento formal ante VIE",
        `${notice("Sometimiento: 28 sep 2026", "Comprueba los documentos antes de someter la propuesta.")}<div class="mt">${["Dictamen de Vinculación incorporado", "Evaluación técnica y productos conformes", "Acuerdos coordinador y participante adjuntos", "Versión final y declaración jurada revisadas"].map((t) => `<label class="checkline"><input type="checkbox" checked>${t}</label>`).join("")}</div>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Someter propuesta", "submit-confirm"),
        false,
        "submit",
      );
      break;
    case "submit-confirm":
      state.stage = "Sometida";
      save();
      closeModal();
      (async () => {
        try {
          await apiPatch("/propuestas/1/estado", {
            id_estado_nuevo: 6,
            id_usuario_responsable: session?.user?.id_usuario || 1,
            observaciones: "Sometimiento formal de la propuesta ante VIE",
          });
          delete apiDossierCache[1];
          loadApiProposals();
        } catch (e) {
          console.warn("Error al sincronizar con PostgreSQL:", e);
        }
      })();
      render();
      toast("Propuesta sometida. Próxima etapa: Dirección.");
      break;
    case "acceptance":
      modal(
        "Carta de aceptación",
        `${notice("Período: 2–6 nov 2026", "La aceptación sigue a una resolución favorable del CIE.")}${doc("Carta de aceptación.pdf")}<label class="checkline"><input type="checkbox" checked>Acepto las condiciones del acuerdo.</label>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Registrar carta", "acceptance-confirm"),
        false,
        "acceptance",
      );
      break;
    case "acceptance-confirm":
      state.stage = "Aceptada";
      save();
      closeModal();
      (async () => {
        try {
          await apiPatch("/propuestas/1/estado", {
            id_estado_nuevo: 11,
            id_usuario_responsable: session?.user?.id_usuario || 1,
            observaciones: "Carta de aceptación suscrita y registrada por la persona investigadora",
          });
          delete apiDossierCache[1];
          loadApiProposals();
        } catch (e) {
          console.warn("Error al sincronizar con PostgreSQL:", e);
        }
      })();
      render();
      toast("Carta de aceptación registrada en el escenario.");
      break;
    case "report":
      modal(
        "Informe de seguimiento",
        `${field("Tipo", ["Informe semestral", "Informe anual", "Informe final"], "select", "", true, "modal:reporttype")}${doc("Informe de resultados.pdf")}<p>El cierre DT requiere productos y oficio final de Vinculación. La certificación corresponde a Dirección.</p>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Registrar informe", "report-save"),
      );
      break;
    case "report-save":
      closeModal();
      toast("Informe registrado en el expediente.");
      break;
    case "return":
      modal(
        "Devolver con observaciones",
        `${field("Observaciones para el investigador", "Completar la justificación del riesgo de campo y vincular la medida con el responsable.", "textarea", "Explica el ajuste requerido y la evidencia esperada.", true, "modal:return")}${notice("La devolución permite corregir", "Se conserva la versión revisada y las observaciones. No equivale a una resolución negativa definitiva.")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Registrar devolución", "return-confirm"),
        false,
        "return",
      );
      break;
    case "return-confirm": {
      state.stage = "Con observaciones";
      const obs = state.saved["modal:return"] || "Completar la justificación del riesgo de campo y vincular la medida con el responsable.";
      save();
      closeModal();
      (async () => {
        try {
          await apiPatch("/propuestas/1/estado", {
            id_estado_nuevo: 9,
            id_usuario_responsable: session?.user?.id_usuario || 4,
            observaciones: obs,
          });
          delete apiDossierCache[1];
          loadApiProposals();
        } catch (e) {
          console.warn("Error al sincronizar con PostgreSQL:", e);
        }
      })();
      go("21");
      toast(
        "Devolución registrada. El investigador podrá atender las observaciones.",
      );
      break;
    }
    case "decision":
      if (!validate("#evaluation-form")) break;
      {
        const id = el.dataset.step,
          sc = scoreResult(),
          negative = id === "24" && !sc.recommended;
        modal(
          "Confirmar decisión",
          `<p>${negative ? "La evaluación no recomienda la propuesta por la nota o los requisitos obligatorios." : "Se conservarán los datos y el documento asociados a esta revisión."}</p>${id === "27" ? notice("Resolución seleccionada", state.saved.resolution || "Aprobada") : ""}<p>Esta acción es una simulación y no emite un acuerdo institucional real.</p>`,
          act("Revisar", "close", "secondary") +
            confirmBtn(
              "Registrar decisión",
              "decision-confirm",
              `data-step="${id}"`,
            ),
          false,
          "decision",
        );
      }
      break;
    case "decision-confirm": {
      const id = el.dataset.step;
      state.stage = {
        23: "En evaluación técnica",
        24: scoreResult().recommended
          ? "En evaluación técnica"
          : "Con observaciones",
        25: "Avalada",
        26:
          state.saved["26:Dictamen"] === "Con observaciones"
            ? "Con observaciones"
            : "Dictaminada",
        27:
          (state.saved.resolution || "Aprobada") === "Rechazada"
            ? "Rechazada"
            : state.saved.resolution === "Con observaciones"
              ? "Con observaciones"
              : "Resuelta",
      }[id];
      save();

      (async () => {
        try {
          const user = session?.user;
          const userId = user?.id_usuario || (id === "23" ? 4 : id === "24" ? 5 : id === "25" ? 6 : id === "26" ? 7 : 8);
          if (id === "23") {
            await apiPatch("/propuestas/1/estado", {
              id_estado_nuevo: 3,
              id_usuario_responsable: userId,
              observaciones: "Dictamen favorable emitido por Centro de Vinculación",
            });
          } else if (id === "24") {
            const sc = scoreResult();
            await apiPost("/propuestas/1/evaluaciones", {
              id_usuario_eval: userId,
              id_rol_evaluador: 3,
              puntaje: Math.round(sc.sum),
              observaciones: sc.recommended ? "Recomendada por Comité Técnico" : "No recomendada por criterios obligatorios o nota insuficiente",
            });
            await apiPatch("/propuestas/1/estado", {
              id_estado_nuevo: sc.recommended ? 4 : 9,
              id_usuario_responsable: userId,
              observaciones: sc.recommended ? "Evaluación técnica aprobada" : "Devuelta con observaciones",
            });
          } else if (id === "25") {
            await apiPatch("/propuestas/1/estado", {
              id_estado_nuevo: 5,
              id_usuario_responsable: userId,
              observaciones: "Aval unánime otorgado en sesión ordinaria del Consejo de Escuela",
            });
          } else if (id === "26") {
            const dic = state.saved["26:Dictamen"] || "Favorable";
            await apiPost("/propuestas/1/evaluaciones", {
              id_usuario_eval: userId,
              id_rol_evaluador: 5,
              observaciones: `Dictamen de Dirección VIE: ${dic}`,
            });
            await apiPatch("/propuestas/1/estado", {
              id_estado_nuevo: dic === "Con observaciones" ? 9 : 7,
              id_usuario_responsable: userId,
              observaciones: `Dictamen Dirección: ${dic}`,
            });
          } else if (id === "27") {
            const resName = state.saved.resolution || "Aprobada";
            const resId = resName === "Rechazada" ? 2 : (resName === "Con observaciones" ? 3 : 1);
            await apiPost("/propuestas/1/evaluaciones", {
              id_usuario_eval: userId,
              id_rol_evaluador: 6,
              id_resolucion: resId,
              observaciones: `Resolución del Consejo de Investigación y Extensión: ${resName}`,
            });
            await apiPatch("/propuestas/1/estado", {
              id_estado_nuevo: resId === 1 ? 8 : (resId === 2 ? 10 : 9),
              id_usuario_responsable: userId,
              observaciones: `Resolución CIE: ${resName}`,
            });
          }
          delete apiDossierCache[1];
          loadApiProposals();
        } catch (e) {
          console.warn("Error al sincronizar con PostgreSQL:", e);
        }
      })();

      modal(
        "Decisión registrada",
        notice(
          "Registro guardado y sincronizado con PostgreSQL",
          id === "25"
            ? "El investigador debe realizar el sometimiento formal. No se envió automáticamente a Dirección."
            : `Nuevo estado registrado con trazabilidad en base de datos: ${state.stage}.`,
        ),
        btn("Volver a la bandeja", "21", "secondary") +
          act(
            "Ver próximo actor",
            "next-actor",
            "",
            "arrow",
            `data-step="${id}"`,
          ),
        false,
        "decision-saved",
      );
      break;
    }
    case "next-actor": {
      const id = el.dataset.step;
      state.role = {
        23: "comite",
        24: scoreResult().recommended ? "consejo" : "investigador",
        25: "investigador",
        26: "cie",
        27: "investigador",
      }[id];
      save();
      go(state.role === "investigador" ? "20" : "21");
      break;
    }
    case "search-history":
      if (
        Number(state.saved["history:from"] || 2024) >
        Number(state.saved["history:to"] || 2028)
      ) {
        toast("El año inicial debe ser menor o igual al año final.");
        break;
      }
      {
        const q = state.saved["history:query"] || "";
        const schoolName = state.saved["history:school"] || "Todas";
        const modeName = state.saved["history:mode"] || "Todas";
        const statusName = state.saved["history:status"] || "Todos";
        const lineName = state.saved["history:line"] || "Todas";

        const params = {};
        if (q) params.q = q;
        if (apiCatalogsCache) {
          if (schoolName !== "Todas") {
            const found = apiCatalogsCache.escuelas.find((e) => e.nombre === schoolName);
            if (found) params.id_escuela = found.id_escuela;
          }
          if (modeName !== "Todas") {
            const found = apiCatalogsCache.modalidades.find((m) => m.nombre_modalidad === modeName);
            if (found) params.id_modalidad = found.id_modalidad;
          }
          if (statusName !== "Todos") {
            const found = apiCatalogsCache.estados.find((s) => s.nombre_estado === statusName);
            if (found) params.id_estado = found.id_estado;
          }
          if (lineName !== "Todas") {
            const found = apiCatalogsCache.lineas_investigacion.find((l) => l.nombre_linea === lineName);
            if (found) params.id_linea_investigacion = found.id_linea_investigacion;
          }
        }
        state.search = q;
        save();
        loadApiProposals(params).then((results) => {
          state.apiSearchResults = results;
          save();
          go("30");
        });
      }
      break;
    case "clear-search":
      Object.keys(state.saved)
        .filter((k) => k.startsWith("history:"))
        .forEach((k) => delete state.saved[k]);
      state.search = "";
      state.apiSearchResults = null;
      save();
      render();
      break;
    case "clear-results":
      Object.keys(state.saved)
        .filter((k) => k.startsWith("history:"))
        .forEach((k) => delete state.saved[k]);
      state.search = "";
      state.apiSearchResults = null;
      save();
      go("29");
      break;
    case "admin-call":
      modal(
        "Configurar convocatoria",
        `${field("Nombre", "Fondos VIE 2027", "text", "", true, "modal:call-name")}${field("Inicio de ejecución", "2027-01-01", "date", "", true, "modal:call-start")}${field("Disposiciones", "Versión 2027", "readonly")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar configuración", "admin-save"),
        false,
        "admin-call",
      );
      break;
    case "admin-calendar":
      modal(
        "Cronograma vigente",
        table(["Etapa", "Fecha"], calendarRows),
        act("Cerrar", "close"),
        true,
      );
      break;
    case "catalog-edit":
      modal(
        "Entrada de catálogo",
        `${field("Nombre", el.dataset.value || "Nueva línea de investigación", "text", "", true, "modal:catalog")}${field("Estado", ["Activo", "Inactivo"], "select", "", false, "modal:catalog-status")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar entrada", "admin-save"),
      );
      break;
    case "admin-save":
      save();
      closeModal();
      toast("Configuración guardada.");
      break;
    case "rubric-summary":
      modal(
        "Rúbrica · Desarrollo tecnológico",
        `${table(
          ["Sección", "Peso"],
          criterionGroups.map(([g, cs]) => [
            g,
            cs.reduce((a, c) => a + c[1], 0) + "%",
          ]),
        )}<div class="mt">${notice("Regla de recomendación", "Nota ≥70, obligatorios con Bueno/Excelente y productos conformes. Niveles: 0, 6, 8, 10.")}</div>`,
        act("Cerrar", "close"),
        true,
        "rubric",
      );
      break;
    case "stages":
      modal(
        "Escenarios de seguimiento",
        '<p>Elige una etapa para demostrar su estado y acciones; no modifica un expediente real.</p><div class="role-grid mt">' +
          stageList
            .concat(["Con observaciones", "Rechazada"])
            .map((s) =>
              act(s, "set-stage", "secondary compact", "", `data-stage="${s}"`),
            )
            .join("") +
          "</div>",
        "",
        true,
        "stages",
      );
      break;
    case "set-stage":
      state.stage = el.dataset.stage;
      state.role = "investigador";
      save();
      go("20");
      break;
    case "guide":
      modal(
        "Guía de recorridos",
        `<p>Explora las 33 pantallas y los escenarios complementarios.</p><div class="stack mt"><div>${btn("1. Formular una propuesta", "04", "secondary")}</div><div>${act("2. Evaluar por roles", "roles", "secondary")}</div><div>${act("3. Consulta histórica", "history-scenario", "secondary")}</div><div>${act("4. Sometimiento después del aval", "set-stage", "secondary", "", 'data-stage="Avalada"')}</div><div>${act("5. Aceptación después del CIE", "set-stage", "secondary", "", 'data-stage="Resuelta"')}</div><div>${act("Reiniciar datos de demostración", "reset", "text")}</div></div><p class="micro muted">Los archivos y decisiones son simulados. Usa el selector de rol para cambiar de contexto institucional.</p>`,
        act("Cerrar", "close"),
        false,
        "guide",
      );
      break;
    case "history-scenario":
      state.role = "direccion";
      save();
      go("29");
      break;
    case "reset":
      state = structuredClone(defaultState);
      if (session) applyRole(ROLE_KEYS[session.user.roles[0]]);
      save();
      go(session ? homeFor() : "01");
      toast("Recorrido reiniciado.");
      break;
    default:
      toast("Acción de demostración disponible desde el expediente.");
  }
}
document.addEventListener("click", (e) => {
  const actionEl = e.target.closest("[data-action]");
  if (actionEl) {
    e.preventDefault();
    handleAction(actionEl.dataset.action, actionEl);
    return;
  }
  const nav = e.target.closest("[data-go]");
  if (nav) {
    e.preventDefault();
    if (nav.dataset.proposal) {
      state.viewProposal = nav.dataset.proposal;
      save();
    }
    go(nav.dataset.go);
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    dossierTab = tab.dataset.tab;
    render();
    return;
  }
  const filter = e.target.closest("[data-filter]");
  if (filter) {
    activeFilter = filter.dataset.filter;
    render();
    return;
  }
  if (e.target.hasAttribute("data-backdrop")) closeModal();
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.field) {
    const priv = el.dataset.field.startsWith("login:"); // lo escrito en el login nunca se guarda (ni la contraseña ni el correo)
    if (!priv) {
      state.saved[el.dataset.field] =
        el.type === "checkbox" ? el.checked : el.value;
      save();
    }
    el.closest(".field")?.classList.remove("error");
    const msg = el.closest(".field")?.querySelector(".error-msg");
    if (msg) msg.hidden = true;
    if (priv) {
      const lb = $("#login-error");
      if (lb) lb.innerHTML = "";
    }
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "reviewed") {
    state.reviewed = el.checked;
    save();
  }
  if (el.dataset.score) {
    state.scores[el.dataset.score] = Number(el.value);
    save();
    const result = scoreResult();
    const n = $("#score-number");
    if (n) n.innerHTML = result.sum.toFixed(1) + "<small> / 100</small>";
    const b = $(".scorebar span");
    if (b) b.style.width = result.sum + "%";
    const r = $("#score-result");
    if (r) {
      r.className = "notice " + (result.recommended ? "" : "warning");
      r.innerHTML = `<div><strong>${result.sum.toFixed(1)} / 100 · ${result.recommended ? "Recomendada" : "No recomendada"}</strong><p>${result.blocked ? "Hay un criterio obligatorio con nivel insuficiente." : "Se consideran nota, obligatorios y producción."}</p></div>`;
    }
  }
  if (el.id === "products-ok") {
    state.notRecommended = !el.checked;
    save();
    const result = scoreResult();
    $("#score-result").innerHTML =
      `<div><strong>${result.sum.toFixed(1)} / 100 · ${result.recommended ? "Recomendada" : "No recomendada"}</strong><p>La producción no sumativa debe cumplir.</p></div>`;
  }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.id === "login-form") handleAction("login", e.target);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Tab" && modalName) {
    const f = $$(
      'button,input,select,textarea,[tabindex="0"]',
      $(".modal"),
    ).filter((x) => !x.disabled);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f.at(-1).focus();
    } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
      e.preventDefault();
      f[0].focus();
    }
  }
});
window.addEventListener("hashchange", () => {
  render();
  const screenId = (location.hash.replace("#", "") || "01");
  if (["06", "21", "22", "29", "30", "32"].includes(screenId)) {
    loadApiProposals().then(() => {
      const currentNow = (location.hash.replace("#", "") || "01");
      if (["06", "21", "30"].includes(currentNow)) {
        render();
      }
    });
  }
});

(async function initApp() {
  render();
  try {
    await Promise.all([numsPropuestas(), propuestaMasReciente(), Notificaciones(), top3PropuestasMasRecientes()]);
    render();
  } catch (e) {
    console.warn("SGPI: Error en precarga de datos:", e);
  }
})();
