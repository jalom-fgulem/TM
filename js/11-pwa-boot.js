// PWA, notificaciones y arranque (debe ir el último)
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

// ---- PWA: instalación y notificaciones ----
let _swReg = null;
let _installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  const btn = document.getElementById('btnInstallApp');
  if (btn) btn.style.display = '';
});
window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  const btn = document.getElementById('btnInstallApp');
  if (btn) btn.style.display = 'none';
});

function installApp(){
  if (!_installPrompt) return;
  _installPrompt.prompt();
  _installPrompt.userChoice.then(() => { _installPrompt = null; });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/TM/sw.js?v=10')
    .then(reg => { _swReg = reg; })
    .catch(() => {});
}

function _swNotify(title, body, opts = {}) {
  if (Notification.permission !== 'granted') return;
  if (_swReg) {
    _swReg.showNotification(title, {
      body,
      icon: '/TM/icon-192.png',
      badge: '/TM/icon-192.png',
      tag: opts.tag || ('tm-' + Date.now()),
      requireInteraction: opts.requireInteraction || false,
      data: { url: opts.url || location.href },
      actions: opts.actions || []
    });
  } else {
    new Notification(title, { body, icon: '/TM/icon-192.png', tag: opts.tag });
  }
}

function _swSchedule(id, delayMs, title, body, opts = {}) {
  if (Notification.permission !== 'granted') return;
  const msg = { type: 'SCHEDULE_NOTIFICATION', id, delay: delayMs, title, body, tag: id, ...opts };
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(msg);
  } else {
    setTimeout(() => _swNotify(title, body, { tag: id, ...opts }), delayMs);
  }
}

async function initNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') return;
  scheduleTaskNotifications();
}

// Los avisos de tareas ya no se lanzan al abrir la aplicación.
//
// Antes saltaban en CADA arranque, lo que resultaba insistente y molesto.
// Ahora las tareas se avisan una sola vez al día, desde el servidor y a la
// hora elegida en Configuración → Notificaciones, donde además se pueden
// desactivar del todo.
function scheduleTaskNotifications() { /* intencionadamente vacío */ }

function scheduleMeetingNotification(ev) {
  if (!ev.start?.dateTime) return;
  const start = new Date(ev.start.dateTime).getTime();
  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;
  const delay5 = start - fiveMin - now;
  const delay0 = start - now;
  const hh = new Date(ev.start.dateTime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const meetLink = ev.hangoutLink || _extractMeetLink(ev);
  const title = ev.summary || 'Reunión';

  if (delay5 > 0) {
    _swSchedule('meet-5-' + ev.id, delay5,
      `📅 En 5 min: ${title}`,
      `Empieza a las ${hh}` + (meetLink ? ' · Reunión online' : ''),
      { requireInteraction: !!meetLink, url: meetLink || location.href }
    );
  }
  if (delay0 > 0 && delay0 < 24 * 60 * 60 * 1000) {
    _swSchedule('meet-0-' + ev.id, delay0,
      `🔴 Ahora: ${title}`,
      `Ha comenzado a las ${hh}` + (meetLink ? ' · Entra ya' : ''),
      { requireInteraction: !!meetLink, url: meetLink || location.href }
    );
  }
}

// ---- Arranque ----
async function bootstrap(){
  const c = initSupabaseAuth();
  if(!c){
    // La librería de sesión aún no ha cargado; reintenta en un instante.
    return setTimeout(bootstrap, 200);
  }

  c.auth.onAuthStateChange((event, session)=>{
    sbSession = session;
    if(event==='SIGNED_IN' && session) storeRefreshToken(session);
  });

  const { data } = await c.auth.getSession();
  sbSession = data ? data.session : null;

  if(!sbSession){ showLoginScreen(); return; }

  // Limpia de la barra de direcciones los restos del retorno de Google.
  if(location.search.includes('code=') || location.hash.includes('access_token')){
    history.replaceState({}, '', location.pathname);
  }

  await storeRefreshToken(sbSession);
  await ensureGoogleToken();
  await loadState();
  initNotifications();
  afterGoogleConnected();
}
bootstrap();

// ===== MOBILE NAV =====
function isMobile(){ return window.innerWidth <= 600; }

function updateMobileNav(){
  if(!isMobile()) return;
  const mainViews = ['panel','calendario','correo'];
  document.querySelectorAll('.mnav-btn').forEach(btn => btn.classList.remove('active'));
  const targetId = mainViews.includes(currentView) ? `mnav-${currentView}` : 'mnav-more';
  document.getElementById(targetId)?.classList.add('active');
}

function toggleMobileMore(){
  const sheet = document.getElementById('mobileMoreSheet');
  const overlay = document.getElementById('mobileMoreOverlay');
  if(!sheet) return;
  const open = sheet.classList.contains('open');
  sheet.classList.toggle('open', !open);
  overlay?.classList.toggle('open', !open);
}

function closeMobileMore(){
  document.getElementById('mobileMoreSheet')?.classList.remove('open');
  document.getElementById('mobileMoreOverlay')?.classList.remove('open');
}

function closeMobileEmailDetail(){
  document.querySelector('.gmail-layout')?.classList.remove('email-open');
}