// Sesión, login con Google y custodia de pases
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

// ---- Google Integration ----
// 🔧 PERSONALIZAR: permisos que la aplicación pide a Google. Si añades uno nuevo,
// tendrás que volver a autorizar (botón "Reautorizar" en Ajustes → Google).
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.settings.basic https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/drive.readonly';
let googleToken = null;      // pase de acceso de 1 hora, lo entrega el servidor
let googleTokenExpiry = 0;
let googleCalendars = []; // [{id, summary, backgroundColor, selected}]
let _tokenRefreshTimer = null;
let _tokenHardExpired = false; // evita lanzar varios refrescos a la vez
let calViewMonth = new Date();
let calViewDate = new Date();
let calView = 'month';
let calSelectedDay = null;
let calMonthEvents = [];
let calHeaderEvents = [];
let showCalLocalTasks = true;
let showCalGTasks = true;
let _meetAlertTimer = null;
let _alertedEvents = new Set();
let calMiniMonth = new Date(); // mini calendar display month (independent navigation)
// Agenda Director sync
let _agendaDirCal = null, _reunionesCal = null;
let _reunionesMissingIds = new Set();
let _reunionesEvents15 = [], _agendaDirEvents15 = [];
let googleTaskLists = [];
let googleTasks = [];
let currentGTaskList = null;
let currentEmailQuery = 'in:inbox';
let gmailUserLabels = [];

// ============================================================
//  SESIÓN Y CONEXIÓN CON GOOGLE
//
//  Antes: el navegador pedía a Google un pase de 1 hora y trataba de renovarlo
//  por su cuenta. Safari bloquea esa renovación, de ahí que pidiera sesión sin
//  parar.
//
//  Ahora: entras con tu cuenta de Google, y el "pase de renovación" de larga
//  duración queda custodiado en el servidor (Supabase). El navegador solo pide
//  pases frescos cuando los necesita. Sin ventanas emergentes y sin depender
//  del navegador.
// ============================================================

let sbClient = null;
let sbSession = null;

function initSupabaseAuth(){
  if(sbClient) return sbClient;
  if(typeof window.supabase === 'undefined') return null;
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:'pkce' }
  });
  return sbClient;
}

// Llama a la función de servidor que custodia el pase de renovación.
async function callTokenFn(body){
  if(!sbSession) return { error:'no_session' };
  try{
    const r = await fetch(`${SUPABASE_URL}/functions/v1/google-token`, {
      method:'POST',
      headers:{
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${sbSession.access_token}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify(body||{})
    });
    return await r.json().catch(()=>({ error:'bad_response' }));
  }catch(e){ return { error:'network' }; }
}

// Guarda en el servidor el pase de renovación que Google entrega al iniciar sesión.
async function storeRefreshToken(session){
  if(!session || !session.provider_refresh_token) return;
  await callTokenFn({ action:'store', refresh_token: session.provider_refresh_token });
}

// Devuelve un pase de acceso de Google válido, pidiéndolo al servidor si hace falta.
async function ensureGoogleToken(force){
  if(!sbSession){ googleToken=null; googleTokenExpiry=0; return null; }
  if(!force && googleToken && googleTokenExpiry > Date.now() + 60000) return googleToken;
  const res = await callTokenFn({});
  if(res && res.access_token){
    googleToken = res.access_token;
    googleTokenExpiry = Date.now() + ((res.expires_in||3600) - 120)*1000;
    _tokenHardExpired = false;
    scheduleTokenRefresh(res.expires_in||3600);
    updateGoogleUI();
    return googleToken;
  }
  googleToken=null; googleTokenExpiry=0;
  if(res && (res.error==='not_connected' || res.error==='reauth_required')){
    setStatus('Hay que volver a autorizar Google.');
  }
  updateGoogleUI();
  return null;
}

function scheduleTokenRefresh(expiresIn){
  if(_tokenRefreshTimer) clearTimeout(_tokenRefreshTimer);
  const delay = Math.max((expiresIn - 300) * 1000, 10000);
  _tokenRefreshTimer = setTimeout(()=>{ ensureGoogleToken(true); }, delay);
}

// El temporizador de arriba no se dispara si el móvil congela la pestaña.
// Por eso comprobamos también cada vez que vuelves a la aplicación.
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible' && sbSession) ensureGoogleToken();
});
window.addEventListener('focus', ()=>{ if(sbSession) ensureGoogleToken(); });

// Iniciar sesión: una sola vez. access_type:offline es lo que hace que Google
// entregue el pase de renovación de larga duración.
async function connectGoogle(){
  const c = initSupabaseAuth();
  if(!c){ setStatus('Cargando librería de sesión. Reintenta en un momento.'); return; }
  const { error } = await c.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_SCOPES,
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { access_type:'offline', prompt:'consent' }
    }
  });
  if(error) setStatus('No se pudo iniciar sesión: '+error.message);
}

async function disconnectGoogle(){
  if(_tokenRefreshTimer){ clearTimeout(_tokenRefreshTimer); _tokenRefreshTimer=null; }
  googleToken=null; googleTokenExpiry=0; googleCalendars=[];
  try{ if(sbClient) await sbClient.auth.signOut(); }catch(e){}
  sbSession=null;
  location.reload();
}

function updateGoogleUI(){
  const el=document.getElementById('googleAuthStatus');
  if(el){
    if(googleToken){
      const who = (sbSession && sbSession.user && sbSession.user.email) ? sbSession.user.email : '';
      const avisoAlias = (typeof _sendAsSinPermiso !== 'undefined' && _sendAsSinPermiso)
        ? `<p class="google-aviso">No se han podido leer tus direcciones de envío ni tus firmas: falta autorizar ese permiso. Pulsa «Volver a autorizar» — solo hay que hacerlo una vez.</p>`
        : '';
      el.innerHTML=`<p class="google-connected">✓ Conectado con Google${who?' — '+escapeHtml(who):''}</p>
        ${avisoAlias}
        <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
          <button class="btn-ghost btn-small" onclick="connectGoogle()">Volver a autorizar</button>
          <button class="btn-ghost btn-small" onclick="disconnectGoogle()">Cerrar sesión</button>
        </div>`;
    } else {
      el.innerHTML=`<button class="btn-ghost btn-small" onclick="connectGoogle()">🔗 Conectar con Google</button>`;
    }
  }
  updateGoogleCalendarConfigUI();
}

// Una API de Google ha respondido 401: pedimos un pase nuevo al servidor.
async function handleGoogleExpired(){
  if(_tokenHardExpired) return; // evita ráfagas de refrescos simultáneos
  _tokenHardExpired = true;
  await ensureGoogleToken(true);
  _tokenHardExpired = false;
}

// Carga los datos de Google una vez tenemos pase válido.
async function afterGoogleConnected(){
  if(!googleToken) return;
  await fetchCalendarList();
  updateGoogleUI();
  fetchGmailLabels();
  fetchSendAsAliases();   // direcciones de envío y sus firmas
  refreshHeaderEvents();
  fetchGoogleTasks();
  if(currentView==='calendario'||currentView==='correo'){ render(); loadAgendaData(); }
  // La app arranca en Correo: hay que cargar la lista, render() solo pinta el marco
  if(currentView==='correo') loadGmailWidget();
  // La agenda de direcciones se rehace sola si falta o si lleva más de una semana
  if(typeof construirAgendaCorreo === 'function' && agendaEdadEnDias() > 7) {
    setTimeout(() => construirAgendaCorreo(false), 4000);   // sin estorbar al arranque
  }
  checkNewMail(true);      // toma la referencia inicial de cambios
  startMailPolling();      // y a partir de ahí se actualiza solo
}

// Al volver a la app, comprobar sin esperar al siguiente ciclo
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible' && googleToken) checkNewMail();
});

// Pantalla de entrada cuando no hay sesión.
function showLoginScreen(){
  document.querySelector('.wrap').style.display='none';
  const el=document.createElement('div');
  el.className='login-screen';
  el.innerHTML=`
    <div class="login-card">
      <h1>Mi Oficina</h1>
      <p>Entra con tu cuenta de Google de la Universidad de León para acceder a tu tablero.</p>
      <button class="btn-primary" onclick="connectGoogle()">Entrar con Google</button>
    </div>`;
  document.body.appendChild(el);
}
async function fetchCalendarList(){
  if(!googleToken) return;
  try{
    const r=await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50',
      {headers:{Authorization:`Bearer ${googleToken}`}});
    if(r.status===401){ handleGoogleExpired(); return; }
    if(!r.ok) return;
    googleCalendars=((await r.json()).items||[]).filter(c=>c.selected!==false);
  }catch(e){}
}