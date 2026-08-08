// Notificaciones en el móvil
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.
//
// Apple solo permite notificaciones web si la aplicación está instalada en la
// pantalla de inicio. Desde Safari como pestaña no funcionan, por mucho
// permiso que se conceda: por eso se comprueba antes y se avisa con claridad.

function esAppInstalada(){
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
}
function esIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// navigator.serviceWorker.ready no responde NUNCA si el servicio no llega a
// activarse, y deja la pantalla colgada sin explicación. Se le pone un límite.
async function swListo(msMax){
  if(!('serviceWorker' in navigator)) return null;
  try{
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise(r => setTimeout(() => r(null), msMax || 6000))
    ]);
    if(reg) return reg;
    return (await navigator.serviceWorker.getRegistration()) || null;
  }catch(e){ return null; }
}

async function llamarPushFn(cuerpo){
  if(!sbSession) return { error: 'no_session' };
  try{
    const r = await fetch(`${SUPABASE_URL}/functions/v1/push-subscribe`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${sbSession.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cuerpo || {})
    });
    return await r.json().catch(() => ({ error: 'bad_response' }));
  }catch(e){ return { error: 'network' }; }
}

// La clave pública viaja como texto y hay que pasarla a bytes
function claveABytes(base64url){
  const relleno = '='.repeat((4 - base64url.length % 4) % 4);
  const base64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = atob(base64);
  return Uint8Array.from(crudo, c => c.charCodeAt(0));
}

async function activarNotificaciones(){
  const aviso = m => { const el = document.getElementById('pushEstado'); if(el) el.innerHTML = m; };

  if(esIOS() && !esAppInstalada()){
    aviso(`<p class="google-aviso">En el iPhone las notificaciones solo funcionan con la aplicación
      instalada en la pantalla de inicio. Ábrela en Safari, pulsa el botón de compartir y elige
      <strong>«Añadir a pantalla de inicio»</strong>. Después, entra desde ahí y vuelve a intentarlo.</p>`);
    return;
  }
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    aviso('<p class="google-aviso">Este navegador no admite notificaciones.</p>');
    return;
  }

  aviso('<p class="help">Pidiendo permiso…</p>');
  let permiso = Notification.permission;
  if(permiso !== 'granted') permiso = await Notification.requestPermission();
  if(permiso !== 'granted'){
    aviso(`<p class="google-aviso">No has concedido el permiso. Si lo rechazaste sin querer, tendrás
      que activarlo desde los ajustes del sistema para esta aplicación.</p>`);
    return;
  }

  try{
    const cfg = await llamarPushFn({ action: 'config' });
    if(!cfg.publicKey){ aviso('<p class="google-aviso">El servidor no está configurado para notificaciones.</p>'); return; }

    const reg = await swListo();
    if(!reg){ aviso('<p class="google-aviso">El servicio en segundo plano no ha llegado a arrancar. Cierra la aplicación del todo, vuelve a abrirla e inténtalo otra vez.</p>'); return; }
    let sus = await reg.pushManager.getSubscription();
    if(!sus){
      sus = await reg.pushManager.subscribe({
        userVisibleOnly: true,               // Apple exige que todo aviso se vea
        applicationServerKey: claveABytes(cfg.publicKey)
      });
    }
    const res = await llamarPushFn({ action: 'subscribe', subscription: sus.toJSON() });
    if(res.error){ aviso('<p class="google-aviso">No se pudo registrar: ' + escapeHtml(res.error) + '</p>'); return; }
    renderEstadoPush();
    setStatus('Notificaciones activadas en este dispositivo.');
  }catch(e){
    aviso('<p class="google-aviso">No se pudieron activar: ' + escapeHtml(String(e.message || e)) + '</p>');
  }
}

async function desactivarNotificaciones(){
  try{
    const reg = await swListo();
    const sus = reg ? await reg.pushManager.getSubscription() : null;
    if(sus){
      await llamarPushFn({ action: 'unsubscribe', endpoint: sus.endpoint });
      await sus.unsubscribe();
    }
    renderEstadoPush();
    setStatus('Notificaciones desactivadas en este dispositivo.');
  }catch(e){ setStatus('No se pudieron desactivar.'); }
}

// Diagnóstico: enseña en qué punto exacto se atasca, en vez de dejarte a ciegas
async function diagnosticoPushHTML(){
  const instalada = esAppInstalada();
  const permiso = ('Notification' in window) ? Notification.permission : 'no disponible';
  let sw = 'no', registrado = 'no';
  try{
    const reg = await navigator.serviceWorker.getRegistration();
    sw = reg ? 'sí' : 'no';
    if(reg && reg.pushManager){
      registrado = (await reg.pushManager.getSubscription()) ? 'sí' : 'no';
    }
  }catch(e){}
  const res = await llamarPushFn({ action: 'status' });
  const enServidor = (res.subscripciones || 0);

  const fila = (etiqueta, valor, bien) =>
    `<div class="diag-fila"><span>${etiqueta}</span><span class="${bien ? 'diag-ok' : 'diag-mal'}">${escapeHtml(String(valor))}</span></div>`;

  return `<div class="diag">
    ${fila('Abierta desde la pantalla de inicio', instalada ? 'sí' : 'no — ábrela desde el icono', instalada)}
    ${fila('Permiso de notificaciones', permiso, permiso === 'granted')}
    ${fila('Servicio en segundo plano', sw, sw === 'sí')}
    ${fila('Suscrito en este dispositivo', registrado, registrado === 'sí')}
    ${fila('Dispositivos en el servidor', enServidor, enServidor > 0)}
  </div>`;
}

async function renderEstadoPush(){
  const el = document.getElementById('pushEstado'); if(!el) return;
  if(!sbSession){ el.innerHTML = '<p class="help">Inicia sesión para configurar las notificaciones.</p>'; return; }

  let activadoAqui = false;
  try{
    const reg = await swListo(3000);
    if(reg && reg.pushManager) activadoAqui = !!(await reg.pushManager.getSubscription());
  }catch(e){}

  const res = await llamarPushFn({ action: 'status' });
  const total = res.subscripciones || 0;

  const avisoIOS = (esIOS() && !esAppInstalada())
    ? `<p class="google-aviso">Estás en Safari. En el iPhone las notificaciones solo llegan con la
       aplicación instalada en la pantalla de inicio.</p>` : '';

  const prefs = res.prefs || {};
  const controles = activadoAqui ? `
    <div class="notif-prefs">
      <p class="sect-h" style="margin:14px 0 8px;">Qué quieres que te avise</p>
      <label class="regla-check"><input type="checkbox" id="npCorreo" ${prefs.correo !== false ? 'checked' : ''} onchange="guardarPrefsAviso()"> Correo nuevo</label>
      <label class="regla-check"><input type="checkbox" id="npReuniones" ${prefs.reuniones !== false ? 'checked' : ''} onchange="guardarPrefsAviso()"> Reuniones a punto de empezar</label>
      <label class="regla-check"><input type="checkbox" id="npTareas" ${prefs.tareas !== false ? 'checked' : ''} onchange="guardarPrefsAviso()"> Tareas vencidas</label>
      <div class="cfg-fields" style="margin-top:6px;">
        <label>Hora del resumen de tareas</label>
        <select id="npHora" onchange="guardarPrefsAviso()">
          ${[7,8,9,10,13,17,20].map(h => `<option value="${h}" ${(prefs.horaTareas ?? 8) === h ? 'selected' : ''}>${String(h).padStart(2,'0')}:00</option>`).join('')}
        </select>
        <p class="help" style="margin-top:5px;">Las tareas llegan en un único aviso a esa hora, no repartidas durante el día mezclándose con el correo.</p>
      </div>
    </div>` : '';

  const diag = await diagnosticoPushHTML();
  el.innerHTML = avisoIOS + diag + controles + (activadoAqui
    ? `<p class="google-connected">✓ Activadas en este dispositivo</p>
       <p class="help">Dispositivos registrados: ${total}. Se te avisará de correo nuevo, reuniones
       a punto de empezar y tareas vencidas.</p>
       <button class="btn-ghost btn-small" style="margin-top:6px;" onclick="desactivarNotificaciones()">Desactivar aquí</button>`
    : `<p class="help">Aún no están activadas en este dispositivo${total ? ` (hay ${total} registrado${total>1?'s':''})` : ''}.</p>
       <button class="btn-primary btn-small" onclick="activarNotificaciones()">Activar notificaciones</button>`);
}

// ============================================================
//  ABRIR EL ELEMENTO CONCRETO AL TOCAR UNA NOTIFICACIÓN
//
//  El aviso trae en la dirección qué debe abrirse (#abrir=correo:hilo:mensaje).
//  Llega por dos vías: si la app estaba cerrada, en la propia dirección al
//  arrancar; si ya estaba abierta, como mensaje del servicio en segundo plano.
// ============================================================

async function esperarPaseDeGoogle(msMax){
  const hasta = Date.now() + (msMax || 15000);
  while(!googleToken && Date.now() < hasta) await new Promise(r => setTimeout(r, 250));
  return !!googleToken;
}

async function abrirDestino(destino){
  if(!destino) return;
  const partes = destino.split(':');
  const tipo = partes[0];

  if(tipo === 'correo'){
    const hilo = partes[1] || '', mensaje = partes[2] || '';
    setView('correo');
    // Arrancando en frío, el pase de Google puede tardar: se espera hasta 15
    // segundos avisando, en vez de rendirse a los 6 y dejarte en la bandeja
    // sin explicación.
    if(!googleToken) setStatus('Abriendo el correo…');
    if(!(await esperarPaseDeGoogle(15000))){
      setStatus('No se pudo abrir ese correo: vuelve a conectar con Google.');
      return;
    }
    // Al llegar sin pase, la vista se dibujó con el cartel de "Conecta con
    // Google" y no existe el panel de lectura. Hay que volver a dibujarla.
    render();
    await new Promise(r => setTimeout(r, 0));
    if(mensaje) await selectEmail(mensaje, hilo);
    return;
  }
  if(tipo === 'reunion'){
    const idEvento = partes.slice(1).join(':');
    setView('calendario');
    if(!(await esperarPaseDeGoogle(15000))) return;
    render();
    await refreshHeaderEvents();
    if(typeof openCalEventModal === 'function' && _findCalEvent(idEvento)) openCalEventModal(idEvento);
    return;
  }
  if(tipo === 'tareas'){
    setView('lista');
    setStatus('Estas son tus tareas pendientes.');
  }
}

function _leerDestinoDeLaDireccion(){
  const h = location.hash || '';
  const m = h.match(/#abrir=(.+)$/);
  if(!m) return null;
  history.replaceState({}, '', location.pathname);   // se limpia para no repetirlo al recargar
  return decodeURIComponent(m[1]);
}

// Lo que el servicio en segundo plano dejó anotado al tocar la notificación.
// Es la vía fiable en el iPhone: al abrir la app desde el aviso, iOS la
// restaura donde estaba y la parte "#abrir=..." de la dirección puede perderse.
async function _destinoAnotado(){
  try{
    if(!('caches' in window)) return null;
    const c = await caches.open('tm-destino');
    const r = await c.match('/__destino');
    if(!r) return null;
    await c.delete('/__destino');            // se consume una sola vez
    const d = await r.json();
    if(!d || !d.url) return null;
    if(Date.now() - (d.ts || 0) > 120000) return null;   // caducado: no era de ahora
    const m = String(d.url).match(/#abrir=(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }catch(e){ return null; }
}

// La app estaba cerrada y se ha abierto desde el aviso
window.addEventListener('load', async () => {
  const destino = _leerDestinoDeLaDireccion() || await _destinoAnotado();
  if(destino) setTimeout(() => abrirDestino(destino), 600);
});

// La app ya estaba abierta
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', e => {
    if(e.data && e.data.type === 'ABRIR_DESTINO'){
      const m = String(e.data.url).match(/#abrir=(.+)$/);
      if(m) abrirDestino(decodeURIComponent(m[1]));
    }
  });
}


async function guardarPrefsAviso(){
  const marcado = id => { const e = document.getElementById(id); return e ? e.checked : true; };
  const prefs = {
    correo: marcado('npCorreo'),
    reuniones: marcado('npReuniones'),
    tareas: marcado('npTareas'),
    horaTareas: parseInt(document.getElementById('npHora')?.value || '8', 10)
  };
  const res = await llamarPushFn({ action: 'prefs', prefs });
  setStatus(res.error ? 'No se pudieron guardar los avisos.' : 'Avisos actualizados.');
}
