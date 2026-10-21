/* Notificaciones: menú de la campana, filtros y orden. Datos reales desde app.js (API). */
let notificationMenuOpen = false;

const NOTIF_KIND = { convocatoria: "calendar" };
const NOTIF_GROUP = (tipo) => (tipo === "convocatoria" ? "Convocatorias" : "Trámites");

const notifDate = (s) =>
  new Date(s).toLocaleString("es-CR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

// Adapta las filas de la API al formato que usa la interfaz
const notificationItems = () =>
  (notificaciones ?? []).map((n) => ({
    id: n.id_notificacion,
    title: n.titulo,
    detail: n.mensaje,
    date: notifDate(n.fecha_creacion),
    order: new Date(n.fecha_creacion).getTime(),
    read: !!n.leida,
    kind: NOTIF_KIND[n.tipo] || "file",
    type: NOTIF_GROUP(n.tipo),
    target: n.tipo === "convocatoria" ? "05" : n.id_propuesta ? "22" : "03",
    proposal: n.id_propuesta ? `SI-${n.id_propuesta}` : "",
  }));

const unreadNotificationItems = () =>
  notificationItems().filter((i) => !i.read).sort((a, b) => b.order - a.order);

const orderedNotificationItems = (items) =>
  [...items].sort((a, b) => Number(a.read) - Number(b.read) || b.order - a.order);

notifications = function () {
  let items = notificationItems();
  if (activeFilter === "Sin leer") items = items.filter((i) => !i.read);
  else if (activeFilter === "Trámites" || activeFilter === "Convocatorias")
    items = items.filter((i) => i.type === activeFilter);
  items = orderedNotificationItems(items);

  const rows = items
    .map(
      (i) =>
        `<div class="list-item notification-row ${i.read ? "read" : "unread"}"><div class="list-icon">${icon(i.kind)}</div><div class="grow"><div class="action-row"><h3>${esc(i.title)}</h3>${i.read ? "" : badge("Sin leer")}</div><p>${esc(i.detail)}</p><small class="micro muted">${i.date}</small></div><button class="btn text" data-action="open-notification" data-notification-id="${i.id}" data-target="${i.target}" data-proposal="${i.proposal}">${icon("arrow")}Ver</button></div>`,
    )
    .join("");

  const empty = `<div class="empty">${icon("check")}<h2>${activeFilter === "Sin leer" ? "Estás al día" : "Sin notificaciones"}</h2><p>No hay notificaciones para este filtro.</p></div>`;
  const hasUnread = unreadNotificationItems().length > 0;

  return shell(
    `${tabs(["Todas", "Sin leer", "Trámites", "Convocatorias"], activeFilter, "data-filter")}<div class="card card-pad">${rows || empty}</div>`,
    "Notificaciones",
    "Novedades y acciones pendientes de tus expedientes.",
    hasUnread ? act("Marcar todas como leídas", "read", "secondary", "check") : "",
  );
};

const originalHandleAction = handleAction;
handleAction = async function (action, el) {
  if (action === "notification-menu") {
    notificationMenuOpen = !notificationMenuOpen;
    userMenuOpen = false;
    render();
    return;
  }
  if (action === "open-notification") {
    marcarLeida(Number(el.dataset.notificationId)); // actualiza local y avisa a la API
    if (el.dataset.proposal) {
      state.viewProposal = el.dataset.proposal;
      save();
    }
    notificationMenuOpen = false;
    go(el.dataset.target);
    return;
  }
  if (action === "user-menu") notificationMenuOpen = false;
  return originalHandleAction(action, el);
};

const originalGo = go;
go = function (id) {
  notificationMenuOpen = false;
  return originalGo(id);
};

function enhanceFinalInterface() {
  document.querySelectorAll(".sidebar>.brand,.login-panel>.brand").forEach((brand) => {
    if (brand.children.length) brand.replaceChildren();
    brand.setAttribute("role", "img");
    brand.setAttribute("aria-label", "Tecnológico de Costa Rica");
  });

  const sidebarNav = document.querySelector(".sidebar nav .nav-group");
  if (sidebarNav && !sidebarNav.querySelector(".nav-notifications")) {
    const nav = document.createElement("button");
    nav.className = "nav-item nav-notifications has-tooltip" + (current === "03" ? " active" : "");
    nav.dataset.go = "03";
    nav.dataset.tooltip = "Consulta todas las notificaciones, nuevas y anteriores.";
    nav.title = "Consulta todas las notificaciones, nuevas y anteriores.";
    nav.innerHTML = icon("bell") + "Notificaciones";
    sidebarNav.querySelector(".nav-item")?.insertAdjacentElement("afterend", nav);
  }

  const unread = unreadNotificationItems();
  const bell = document.querySelector(".topbar .icon-btn");
  if (bell) {
    bell.removeAttribute("data-go");
    bell.dataset.action = "notification-menu";
    bell.setAttribute("aria-haspopup", "menu");
    bell.setAttribute("aria-expanded", String(notificationMenuOpen));
    bell.setAttribute(
      "aria-label",
      unread.length ? `Mostrar ${unread.length} notificaciones sin leer` : "No hay notificaciones sin leer",
    );
    const dot = bell.querySelector(".notif-dot");
    if (unread.length && !dot) bell.insertAdjacentHTML("beforeend", '<span class="notif-dot"></span>');
    if (!unread.length && dot) dot.remove();
  }

  const actions = document.querySelector(".topbar-actions");
  if (actions && notificationMenuOpen && !actions.querySelector(".notification-menu")) {
    const menu = document.createElement("section");
    menu.className = "notification-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Notificaciones nuevas");
    menu.innerHTML =
      (unread.length
        ? '<div class="notification-menu-head"><strong>Notificaciones sin leer</strong><span class="badge">' +
          unread.length +
          '</span></div><div class="notification-menu-list">' +
          unread
            .slice(0, 5)
            .map(
              (i) =>
                '<button class="notification-menu-item" role="menuitem" data-action="open-notification" data-notification-id="' +
                i.id + '" data-target="' + i.target + '" data-proposal="' + i.proposal + '">' +
                icon(i.kind) + "<span><strong>" + esc(i.title) + "</strong><span>" + esc(i.detail) + "</span></span></button>",
            )
            .join("") +
          "</div>"
        : "") + '<button class="notification-menu-more" data-go="03">Ver todas las notificaciones →</button>';
    actions.appendChild(menu);
  }
}
enhanceFinalInterface();
new MutationObserver(enhanceFinalInterface).observe(document.getElementById("app"), { childList: true, subtree: true });
if (current === "03") render();