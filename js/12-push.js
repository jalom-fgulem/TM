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

  const diag = await diagnosticoPushHTML();
  el.innerHTML = avisoIOS + diag + (activadoAqui
    ? `<p class="google-connected">✓ Activadas en este dispositivo</p>
       <p class="help">Dispositivos registrados: ${total}. Se te avisará de correo nuevo, reuniones
       a punto de empezar y tareas vencidas.</p>
       <button class="btn-ghost btn-small" style="margin-top:6px;" onclick="desactivarNotificaciones()">Desactivar aquí</button>`
    : `<p class="help">Aún no están activadas en este dispositivo${total ? ` (hay ${total} registrado${total>1?'s':''})` : ''}.</p>
       <button class="btn-primary btn-small" onclick="activarNotificaciones()">Activar notificaciones</button>`);
}
