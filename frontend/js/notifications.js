    /* Lectura individual, filtros y orden de las notificaciones. */
    let notificationMenuOpen = false;
    const notificationCatalog = [
      { id: 'draft-saved', title: 'Tu borrador está guardado', detail: 'SI-2027-014 · Continúa con presupuesto y documentos.', date: '21 ago 2026 · 10:42', target: '15', kind: 'file', type: 'Trámites', order: 3, defaultRead: false },
      { id: 'call-deadline', title: 'Fondos VIE 2027: fecha de sometimiento', detail: 'Recuerda que necesitas evaluación técnica y aval antes del 28 de septiembre.', date: '20 ago 2026 · 08:00', target: '05', kind: 'calendar', type: 'Convocatorias', order: 2, defaultRead: false },
      { id: 'report-ready', title: 'Informe de seguimiento disponible', detail: 'SI-2026-021 · Vulnerabilidad hídrica en microcuencas.', date: '19 ago 2026 · 14:20', target: '22', kind: 'file', type: 'Trámites', order: 1, defaultRead: true }
    ];
    const notificationIsRead = item => {
      const map = state.notificationRead || {};
      if (Object.prototype.hasOwnProperty.call(map, item.id)) return !!map[item.id];
      return item.defaultRead || !!state.read;
    };
    const unreadNotificationItems = () => notificationCatalog.filter(item => !notificationIsRead(item)).sort((a, b) => b.order - a.order);
    const orderedNotificationItems = items => [...items].sort((a, b) => Number(notificationIsRead(a)) - Number(notificationIsRead(b)) || b.order - a.order);
    const markNotificationRead = id => {
      state.notificationRead = { ...(state.notificationRead || {}), [id]: true };
      save();
    };
    notifications = function () {
      let items = notificationCatalog;
      if (activeFilter === 'Sin leer') items = items.filter(item => !notificationIsRead(item));
      else if (activeFilter === 'Trámites' || activeFilter === 'Convocatorias') items = items.filter(item => item.type === activeFilter);
      items = orderedNotificationItems(items);
      const rows = items.map(item => {
        const read = notificationIsRead(item);
        return `<div class="list-item notification-row ${read ? 'read' : 'unread'}"><div class="list-icon">${icon(item.kind)}</div><div class="grow"><div class="action-row"><h3>${item.title}</h3>${read ? '' : badge('Sin leer')}</div><p>${item.detail}</p><small class="micro muted">${item.date}</small></div><button class="btn text" data-action="open-notification" data-notification-id="${item.id}" data-target="${item.target}">${icon('arrow')}Ver</button></div>`;
      }).join('');
      const empty = `<div class="empty">${icon('check')}<h2>Estás al día</h2><p>No hay notificaciones para este filtro.</p></div>`;
      return shell(`${tabs(['Todas', 'Sin leer', 'Trámites', 'Convocatorias'], activeFilter, 'data-filter')}<div class="card card-pad">${rows || empty}</div>`, 'Notificaciones', 'Novedades y acciones pendientes de tus expedientes.', '');
    };
    const originalHandleAction = handleAction;
    handleAction = async function (action, el) {
      if (action === 'notification-menu') {
        notificationMenuOpen = !notificationMenuOpen;
        userMenuOpen = false;
        render();
        return;
      }
      if (action === 'open-notification') {
        markNotificationRead(el.dataset.notificationId);
        notificationMenuOpen = false;
        go(el.dataset.target);
        return;
      }
      if (action === 'user-menu') notificationMenuOpen = false;
      return originalHandleAction(action, el);
    };
    const originalGo = go;
    go = function (id) { notificationMenuOpen = false; return originalGo(id); };
    function enhanceFinalInterface() {
      document.querySelectorAll('.sidebar>.brand,.login-panel>.brand').forEach(brand => {
        if (brand.children.length) brand.replaceChildren();
        brand.setAttribute('role', 'img');
        brand.setAttribute('aria-label', 'Tecnológico de Costa Rica');
      });
      const sidebarNav = document.querySelector('.sidebar nav .nav-group');
      if (sidebarNav && !sidebarNav.querySelector('.nav-notifications')) {
        const notificationNav = document.createElement('button');
        notificationNav.className = 'nav-item nav-notifications has-tooltip' + (current === '03' ? ' active' : '');
        notificationNav.dataset.go = '03';
        notificationNav.dataset.tooltip = 'Consulta todas las notificaciones, nuevas y anteriores.';
        notificationNav.title = 'Consulta todas las notificaciones, nuevas y anteriores.';
        notificationNav.innerHTML = icon('bell') + 'Notificaciones';
        const firstItem = sidebarNav.querySelector('.nav-item');
        firstItem?.insertAdjacentElement('afterend', notificationNav);
      }
      const bell = document.querySelector('.topbar .icon-btn');
      if (bell) {
        bell.removeAttribute('data-go');
        bell.dataset.action = 'notification-menu';
        bell.setAttribute('aria-haspopup', 'menu');
        bell.setAttribute('aria-expanded', String(notificationMenuOpen));
        const unreadCount = unreadNotificationItems().length;
        bell.setAttribute('aria-label', unreadCount ? `Mostrar ${unreadCount} notificaciones sin leer` : 'No hay notificaciones sin leer');
        const dot = bell.querySelector('.notif-dot');
        if (unreadCount && !dot) bell.insertAdjacentHTML('beforeend', '<span class="notif-dot"></span>');
        if (!unreadCount && dot) dot.remove();
      }
      const actions = document.querySelector('.topbar-actions');
      if (actions && notificationMenuOpen && !actions.querySelector('.notification-menu')) {
        const items = unreadNotificationItems();
        const menu = document.createElement('section');
        menu.className = 'notification-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Notificaciones nuevas');
        menu.innerHTML = (items.length ? '<div class="notification-menu-head"><strong>Notificaciones sin leer</strong><span class="badge">' + items.length + '</span></div><div class="notification-menu-list">' + items.map(item => '<button class="notification-menu-item" role="menuitem" data-action="open-notification" data-notification-id="' + item.id + '" data-target="' + item.target + '">' + icon(item.kind) + '<span><strong>' + item.title + '</strong><span>' + item.detail + '</span></span></button>').join('') + '</div>' : '') +
          '<button class="notification-menu-more" data-go="03">Ver todas las notificaciones →</button>';
        actions.appendChild(menu);
      }
    }
    enhanceFinalInterface();
    new MutationObserver(enhanceFinalInterface).observe(document.getElementById('app'), { childList: true, subtree: true });
    if (current === '03') render();
  
