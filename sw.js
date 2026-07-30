// Service Worker — network-first con soporte de notificaciones en segundo plano
const CACHE = 'tm-v8';   // se sube al cambiar el nombre: así se tira la copia vieja

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./'])));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  // 'no-cache' obliga a revalidar con el servidor en cada carga. Sin esto, el
  // navegador podía seguir sirviendo JavaScript antiguo hasta diez minutos
  // después de publicar, y convivían dos versiones del mismo código a la vez.
  // La revalidación es barata: si no ha cambiado, el servidor responde 304.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Notificaciones desde la página principal (funciona aunque la pestaña esté minimizada)
const _pendingTimers = new Map();

self.addEventListener('message', e => {
  const data = e.data;
  if (!data) return;

  if (data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(data.title, {
      body: data.body || '',
      icon: data.icon || '/TM/icon-192.png',
      badge: '/TM/icon-192.png',
      tag: data.tag || 'tm-' + Date.now(),
      data: { url: data.url || '/' },
      requireInteraction: data.requireInteraction || false,
      actions: data.actions || []
    });
  }

  if (data.type === 'SCHEDULE_NOTIFICATION') {
    const { id, delay, title, body, tag, url, requireInteraction, actions } = data;
    if (_pendingTimers.has(id)) {
      clearTimeout(_pendingTimers.get(id));
    }
    const timer = setTimeout(() => {
      _pendingTimers.delete(id);
      self.registration.showNotification(title, {
        body: body || '',
        icon: '/TM/icon-192.png',
        badge: '/TM/icon-192.png',
        tag: tag || id,
        data: { url: url || '/' },
        requireInteraction: requireInteraction || false,
        actions: actions || []
      });
    }, delay);
    _pendingTimers.set(id, timer);
  }

  if (data.type === 'CANCEL_NOTIFICATION') {
    if (_pendingTimers.has(data.id)) {
      clearTimeout(_pendingTimers.get(data.id));
      _pendingTimers.delete(data.id);
    }
  }
});

// Aviso llegado desde el servidor (funciona con la app cerrada)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Mi Oficina', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Mi Oficina', {
      body: d.body || '',
      icon: '/TM/icon-192.png',
      badge: '/TM/icon-192.png',
      tag: d.tag || 'tm-push',
      data: { url: d.url || '/TM/' }
    })
  );
});

// Al hacer clic en una notificación, abre/enfoca la app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/TM/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const abierta = clients.find(c => c.url.includes('/TM') || c.url.includes('localhost'));
      if (abierta) {
        // Ya está abierta: se le indica qué abrir, porque cambiar la dirección
        // de una ventana existente no siempre la hace reaccionar.
        abierta.postMessage({ type: 'ABRIR_DESTINO', url });
        return abierta.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
