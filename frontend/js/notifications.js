/**
 * ============================================================================
 * 2.1. OBJETIVO DEL ARCHIVO:
 * Gestionar la presentación, filtrado, ordenamiento e interacción de las
 * notificaciones del SGPI, incluyendo el menú flotante de la campana en la
 * barra superior, el indicador de mensajes no leídos, la pantalla completa
 * de novedades (Pantalla 03) y la navegación contextual hacia los expedientes.
 *
 * 2.2. RELACIONES:
 * 2.2.1. De dónde obtiene datos:
 *   - De la variable reactiva global 'notificaciones' administrada por app.js
 *     (poblada mediante peticiones a la API: /notificaciones/notificaciones).
 *   - De las variables de estado globales de app.js: 'activeFilter', 'current',
 *     'state', y 'session'.
 * 2.2.2. A dónde envía datos:
 *   - A app.js mediante las funciones globales 'marcarLeida(id)' y 'go(target)'.
 *   - Al almacenamiento local 'state.viewProposal' para enfocar el expediente
 *     seleccionado antes de la navegación.
 *   - Al DOM del navegador, inyectando menús desplegables, badges y opciones en el sidebar.
 *
 * 2.3. A GROSO MODO ¿QUÉ HACE EL ARCHIVO?:
 * Transforma las entidades planas de notificación del backend a modelos de vista
 * con iconos, fechas en formato costarricense (es-CR) y destinos de navegación.
 * Intercepta los despachadores de acciones y navegación (handleAction y go) para
 * abrir/cerrar menús flotantes, y sincroniza mediante un MutationObserver la
 * presencia del botón de notificaciones en el menú lateral y el estado del icono
 * de campana en la barra superior.
 * ============================================================================
 */

// Estado interactivo del menú desplegable de notificaciones en el topbar
let notificationMenuOpen = false;

/**
 * Mapeo de diccionario tipo Enum que asocia tipos semánticos de notificación con iconos SVG del sistema.
 * Asigna llaves de tipo de notificación con el identificador del path vectorial correspondiente.
 * Se consume en notificationItems() para determinar el pictograma visual a renderizar.
 * atributos:
 *     * string : convocatoria Identificador de icono de calendario para eventos de convocatoria.
 */
const NOTIF_KIND = { convocatoria: "calendar" };

/**
 * Categorizar y agrupar la notificación en una taxonomía simplificada para filtrado por pestañas.
 * Evalúa el tipo de notificación y retorna 'Convocatorias' si coincide; de lo contrario clasifica como 'Trámites'.
 * parametros:
 *     - string : tipo Código textual del tipo de evento notificado.
 * return:
 *     + string : categoria Nombre del grupo de filtro ('Convocatorias' o 'Trámites').
 */
const NOTIF_GROUP = (tipo) => (tipo === "convocatoria" ? "Convocatorias" : "Trámites");

/**
 * Formatear cadenas temporales ISO a una representación legible en español de Costa Rica.
 * Instancia un objeto Date a partir del timestamp y aplica toLocaleString con configuración es-CR.
 * parametros:
 *     - string : s Cadena de fecha/hora en formato ISO o compatible con Date.
 * return:
 *     + string : fechaFormateada Cadena de texto amigable con día, mes abreviado, año, hora y minuto.
 */
const notifDate = (s) =>
  new Date(s).toLocaleString("es-CR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Adaptar la colección de notificaciones provista por el backend a la estructura que requiere la UI.
 * Itera sobre el arreglo global notificaciones, mapeando atributos de base de datos a propiedades
 * de presentación (título, detalle, fecha formateada, bandera de leída, destino de navegación).
 * parametros:
 *     (ninguno)
 * return:
 *     + Array<Object> : items Colección de objetos de notificación formateados y enriquecidos para la interfaz.
 */
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
    // [Línea clave]: ¿Por qué soy importante? Determina dinámicamente la pantalla de destino. ¿Para qué? Redirigir a '05' (Convocatoria), '22' (Expediente de propuesta) o '03' (Listado general). ¿Dónde me usan? En la asignación de propiedad target del objeto retornado.
    target: n.tipo === "convocatoria" ? "05" : n.id_propuesta ? "22" : "03",
    proposal: n.id_propuesta ? `SI-${n.id_propuesta}` : "",
  }));

/**
 * Obtener exclusivamente las notificaciones pendientes de lectura ordenadas cronológicamente descendente.
 * Filtra los elementos de notificationItems() con read === false y los ordena por su marca temporal.
 * parametros:
 *     (ninguno)
 * return:
 *     + Array<Object> : unreadItems Lista de notificaciones sin leer ordenadas de la más reciente a la más antigua.
 */
const unreadNotificationItems = () =>
  notificationItems()
    .filter((i) => !i.read)
    .sort((a, b) => b.order - a.order);

/**
 * Ordenar una lista de notificaciones priorizando las no leídas primero y luego por fecha más reciente.
 * Realiza un ordenamiento con operador de comparación combinada: no leídas (0) antes que leídas (1), y luego por timestamp descendente.
 * parametros:
 *     - Array<Object> : items Arreglo de elementos de notificación a ordenar.
 * return:
 *     + Array<Object> : orderedItems Nueva copia ordenada del arreglo recibido.
 */
const orderedNotificationItems = (items) =>
  [...items].sort((a, b) => Number(a.read) - Number(b.read) || b.order - a.order);

/**
 * Construir y retornar el marcado HTML completo para la Pantalla 03 (Centro de Notificaciones).
 * Aplica el filtro activo (Todas, Sin leer, Trámites, Convocatorias), genera las filas de tarjetas
 * correspondientes o el mensaje de bandeja vacía, e invoca shell() para encapsular la vista con pestañas y botón de acción masiva.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : html Marcado HTML estructurado para renderizar la pantalla en el contenedor principal.
 */
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

// [Línea clave]: ¿Por qué soy importante? Conserva la referencia al despachador original antes de interceptarlo. ¿Para qué? Delegar las acciones no vinculadas al módulo de notificaciones. ¿Dónde me usan? Como fallback al final de la nueva definición de handleAction.
const originalHandleAction = handleAction;

/**
 * Manejar y despachar las acciones de usuario asociadas a notificaciones, delegando las demás al despachador general.
 * Evalúa los identificadores de acción ('notification-menu', 'open-notification', 'user-menu'),
 * actualiza los estados de interfaz, registra la lectura de la notificación y redirige a la pantalla destino.
 * parametros:
 *     - string : action Nombre clave de la acción desencadenada por el evento.
 *     - HTMLElement : el Elemento del DOM que originó el evento y contiene atributos data-*.
 * return:
 *     + Promise<any> : resultado Retorna el resultado de la delegación a originalHandleAction o void tras resolver.
 */
handleAction = async function (action, el) {
  if (action === "notification-menu") {
    notificationMenuOpen = !notificationMenuOpen;
    userMenuOpen = false;
    render();
    return;
  }
  if (action === "open-notification") {
    // [Línea clave]: ¿Por qué soy importante? Sincroniza la lectura local y asíncrona hacia el backend. ¿Para qué? Marcar el registro como leído inmediatamente. ¿Dónde me usan? Al pulsar el botón 'Ver' en una notificación.
    marcarLeida(Number(el.dataset.notificationId));
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

// [Línea clave]: ¿Por qué soy importante? Resguarda la función de navegación original de app.js. ¿Para qué? Asegurar que el menú flotante se cierre automáticamente al navegar entre pantallas. ¿Dónde me usan? Dentro de la envoltura de la función go.
const originalGo = go;

/**
 * Envolver la función de navegación global go() para garantizar el cierre del menú de notificaciones.
 * Restablece la bandera notificationMenuOpen a false e invoca inmediatamente la función original originalGo(id, recargar).
 * parametros:
 *     - string : id Identificador numérico o alfanumérico de la pantalla de destino.
 *     - boolean : recargar Fuerza la descarga de los datos aunque la pantalla ya sea la actual.
 * return:
 *     + any : resultado El valor devuelto por la función originalGo.
 */
go = function (id, recargar = false) {
  notificationMenuOpen = false;
  return originalGo(id, recargar);
};

/**
 * Enriquecer dinámicamente la interfaz DOM inyectando accesos directos, badges y el menú flotante de notificaciones.
 * Configura accesibilidad y atributos en los logotipos, inserta la opción de menú 'Notificaciones' en el
 * sidebar de navegación, actualiza el icono de la campana en el topbar con su punto indicador (.notif-dot)
 * y genera el menú desplegable (.notification-menu) con las novedades más recientes cuando está abierto.
 * parametros:
 *     (ninguno)
 * return:
 *     + void : undefined Modifica directamente la estructura de elementos en el DOM.
 */
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

// [Línea clave]: ¿Por qué soy importante? Ejecución inicial inmediata. ¿Para qué? Inyectar elementos de notificación apenas termina de cargar este script. ¿Dónde me usan? En el arranque del archivo.
enhanceFinalInterface();

// [Línea clave]: ¿Por qué soy importante? Observador reactivo de mutaciones. ¿Para qué? Reinyectar la campana, dot y sidebar cada vez que app.js re-renderiza la vista en #app. ¿Dónde me usan? En la suscripción reactiva principal del documento.
new MutationObserver(enhanceFinalInterface).observe(document.getElementById("app"), {
  childList: true,
  subtree: true,
});

if (current === "03") render();
