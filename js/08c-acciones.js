// Acciones sobre conversaciones: archivar, borrar, spam, mover — con deshacer
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.
//
// IMPORTANTE: todas actúan sobre la CONVERSACIÓN entera, no sobre un mensaje
// suelto. Antes se borraba solo el último mensaje del hilo, de modo que una
// conversación de dos correos reaparecía en cuanto se refrescaba la lista.

let _deshacerTimer = null;

// ---- Aviso con opción de deshacer ----
function mostrarDeshacer(mensaje, alDeshacer, segundos){
  segundos = segundos || 10;
  ocultarDeshacer();

  const caja = document.createElement('div');
  caja.className = 'undo-toast';
  caja.id = 'undoToast';
  caja.innerHTML = `
    <span class="undo-txt">${escapeHtml(mensaje)}</span>
    <button class="undo-btn" id="undoBtn">Deshacer</button>
    <span class="undo-seg" id="undoSeg">${segundos}</span>`;
  document.body.appendChild(caja);

  document.getElementById('undoBtn').onclick = async () => {
    ocultarDeshacer();
    try{ await alDeshacer(); }catch(e){ setStatus('No se pudo deshacer.'); }
  };

  let quedan = segundos;
  _deshacerTimer = setInterval(() => {
    quedan--;
    const s = document.getElementById('undoSeg');
    if(s) s.textContent = quedan;
    if(quedan <= 0) ocultarDeshacer();
  }, 1000);
}
function ocultarDeshacer(){
  if(_deshacerTimer){ clearInterval(_deshacerTimer); _deshacerTimer = null; }
  const t = document.getElementById('undoToast');
  if(t) t.remove();
}

// ---- Llamada base sobre una conversación ----
async function accionHilo(threadId, ruta, cuerpo){
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/${ruta}`, {
    method: 'POST',
    headers: Object.assign({ Authorization: `Bearer ${googleToken}` },
      cuerpo ? { 'Content-Type': 'application/json' } : {}),
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  if(r.status === 401){ await handleGoogleExpired(); throw new Error('sesion'); }
  if(!r.ok) throw new Error('HTTP ' + r.status);
  return r;
}

// Quita la conversación de la lista y pasa a la siguiente
function sacarDeLaLista(threadId){
  // También del listado guardado en memoria: si no, al pedir más correos el
  // que acabas de archivar reaparecería.
  if(typeof _correosCargados !== 'undefined'){
    _correosCargados = _correosCargados.filter(m => (m.threadId || m._threadId || m.id) !== threadId);
  }
  const fila = document.querySelector(`.gmail-list-item[data-tid="${threadId}"]`);
  const sub = document.getElementById('thread-sub-' + threadId);
  if(sub) sub.remove();
  if(fila){
    const idMostrado = fila.dataset.id;
    if(selectedEmailId === idMostrado) selectNextEmail(idMostrado);
    fila.remove();
  }
  cerrarLecturaSiEsEsta(threadId);
}

// Si acabas de archivar o borrar el correo que tienes abierto, no tiene sentido
// seguir mirándolo. Pasa sobre todo al llegar desde una notificación: la lista
// aún no está detrás, así que hay que devolverte a ella a mano.
function cerrarLecturaSiEsEsta(threadId){
  if(!_currentThread || _currentThread.id !== threadId) return;
  _currentThread = null;
  _currentEmailMsg = null;
  selectedEmailId = null;
  if(_lecturaAmpliada && typeof cerrarLecturaAmpliada === 'function') cerrarLecturaAmpliada();
  if(isMobile()){
    closeMobileEmailDetail();
    if(!document.querySelector('.gmail-list-item')) loadGmailWidget();
  }
  const col = document.getElementById('gmailPreviewCol');
  if(col) col.innerHTML = '<div class="gmail-preview-empty"><i class="ti ti-mail" style="font-size:32px;opacity:.3;" aria-hidden="true"></i><span>Selecciona un correo</span></div>';
}

// ---- Archivar ----
async function archiveEmail(threadId){
  if(!googleToken || !threadId) return;
  try{
    await accionHilo(threadId, 'modify', { removeLabelIds: ['INBOX'] });
    sacarDeLaLista(threadId);
    mostrarDeshacer('Conversación archivada.', async () => {
      await accionHilo(threadId, 'modify', { addLabelIds: ['INBOX'] });
      loadGmailWidget();
      setStatus('Se ha devuelto a la bandeja.');
    });
  }catch(e){ if(e.message !== 'sesion') setStatus('No se pudo archivar.'); }
}

// ---- Papelera ----
async function deleteEmail(threadId){
  if(!googleToken || !threadId) return;
  try{
    await accionHilo(threadId, 'trash');
    sacarDeLaLista(threadId);
    mostrarDeshacer('Conversación movida a la papelera.', async () => {
      await accionHilo(threadId, 'untrash');
      loadGmailWidget();
      setStatus('Recuperada de la papelera.');
    });
  }catch(e){ if(e.message !== 'sesion') setStatus('No se pudo borrar.'); }
}

// ---- Spam ----
async function marcarComoSpam(threadId){
  if(!googleToken || !threadId) return;
  showConfirm('¿Marcar como spam? Se moverá toda la conversación y Gmail aprenderá de remitentes parecidos.', async () => {
    closeModal();
    try{
      await accionHilo(threadId, 'modify', { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] });
      sacarDeLaLista(threadId);
      mostrarDeshacer('Marcada como spam.', async () => {
        await accionHilo(threadId, 'modify', { removeLabelIds: ['SPAM'], addLabelIds: ['INBOX'] });
        loadGmailWidget();
        setStatus('Ya no está marcada como spam.');
      });
    }catch(e){ if(e.message !== 'sesion') setStatus('No se pudo marcar como spam.'); }
  });
}

// ---- Mover a una etiqueta (lo que hace el arrastre) ----
async function moverHiloAEtiqueta(threadId, labelId, nombreEtiqueta){
  if(!googleToken || !threadId || !labelId) return;
  const estabaEnBandeja = currentEmailQuery === 'in:inbox';
  try{
    await accionHilo(threadId, 'modify',
      estabaEnBandeja ? { addLabelIds: [labelId], removeLabelIds: ['INBOX'] }
                      : { addLabelIds: [labelId] });
    if(estabaEnBandeja) sacarDeLaLista(threadId);
    mostrarDeshacer(`Movida a ${nombreEtiqueta}.`, async () => {
      await accionHilo(threadId, 'modify',
        estabaEnBandeja ? { removeLabelIds: [labelId], addLabelIds: ['INBOX'] }
                        : { removeLabelIds: [labelId] });
      loadGmailWidget();
      setStatus('Movimiento deshecho.');
    });
  }catch(e){ if(e.message !== 'sesion') setStatus('No se pudo mover la conversación.'); }
}

// ============================================================
//  ARRASTRAR CORREOS A LAS ETIQUETAS
//
//  Se usa el arrastre nativo del navegador. Funciona con ratón; en tabletas
//  con el dedo no está disponible, ahí sigue estando el botón de etiquetar.
// ============================================================

document.addEventListener('dragstart', e => {
  const fila = e.target.closest('.gmail-list-item');
  if(!fila) return;
  e.dataTransfer.setData('text/plain', fila.dataset.tid || '');
  e.dataTransfer.effectAllowed = 'move';
  fila.classList.add('arrastrando');
  document.body.classList.add('gm-arrastrando-correo');
});

document.addEventListener('dragend', e => {
  document.querySelectorAll('.gmail-list-item.arrastrando').forEach(f => f.classList.remove('arrastrando'));
  document.querySelectorAll('.soltar-aqui').forEach(z => z.classList.remove('soltar-aqui'));
  document.body.classList.remove('gm-arrastrando-correo');
});

function _zonaDeSuelta(target){
  return target.closest('[data-label-id]');
}
document.addEventListener('dragover', e => {
  const zona = _zonaDeSuelta(e.target);
  if(!zona) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  zona.classList.add('soltar-aqui');
});
document.addEventListener('dragleave', e => {
  const zona = _zonaDeSuelta(e.target);
  if(zona) zona.classList.remove('soltar-aqui');
});
document.addEventListener('drop', e => {
  const zona = _zonaDeSuelta(e.target);
  if(!zona) return;
  e.preventDefault();
  zona.classList.remove('soltar-aqui');
  const threadId = e.dataTransfer.getData('text/plain');
  if(!threadId) return;
  moverHiloAEtiqueta(threadId, zona.dataset.labelId, zona.dataset.labelName || 'la etiqueta');
});

// ============================================================
//  ACCIONES DESDE LA LISTA, SIN ABRIR EL CORREO
//
//  Necesitan datos del mensaje (etiquetas actuales, remitente), así que se
//  piden al vuelo. Es una petición pequeña y evita tener que abrirlo.
// ============================================================

async function _traerMensaje(msgId, formato){
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=${formato || 'minimal'}`,
    { headers: { Authorization: `Bearer ${googleToken}` } });
  if(r.status === 401){ await handleGoogleExpired(); return null; }
  if(!r.ok) return null;
  return await r.json();
}

async function destacarDesdeLista(msgId, threadId){
  if(!googleToken) return;
  const m = await _traerMensaje(msgId); if(!m) return;
  const tiene = (m.labelIds || []).includes('STARRED');
  try{
    await accionHilo(threadId, 'modify', tiene ? { removeLabelIds: ['STARRED'] } : { addLabelIds: ['STARRED'] });
    // Actualiza el icono sin recargar toda la lista
    const btn = document.querySelector(`.gmail-list-item[data-id="${msgId}"] .gli-acc`);
    if(btn){
      btn.classList.toggle('on', !tiene);
      btn.innerHTML = estrellaHTML(!tiene);
    }
    setStatus(tiene ? 'Destacado quitado.' : 'Correo destacado.');
  }catch(e){ if(e.message !== 'sesion') setStatus('No se pudo cambiar el destacado.'); }
}

// Reutiliza el selector de etiquetas, cargando antes el mensaje
async function etiquetarDesdeLista(msgId, threadId){
  if(!googleToken) return;
  const m = await _traerMensaje(msgId, 'metadata'); if(!m) return;
  _currentThread = { id: threadId, messages: [m] };
  abrirSelectorEtiquetas(msgId);
}

async function reglaDesdeLista(msgId){
  if(!googleToken) return;
  const m = await _traerMensaje(msgId, 'metadata'); if(!m) return;
  abrirEditorRegla({ from: emBareAddress(emHeader(m, 'From')) });
}

// ============================================================
//  DESLIZAR UN CORREO PARA ARCHIVARLO O BORRARLO
//
//  Pensado para el móvil, donde acertar con un botón de 24 píxeles es
//  incómodo. Solo se activa si el movimiento es claramente horizontal, para
//  no estorbar al desplazamiento vertical de la lista.
// ============================================================

const SWIPE_UMBRAL = 90;          // píxeles a partir de los cuales se ejecuta
let _sw = null;
const _iconoCache = {};

// Los iconos son un tipo de letra: se le pregunta a él cuál es el carácter y la
// familia, así no hay que codificar códigos internos que cambian con las
// actualizaciones de la librería.
function iconoComoTexto(clase){
  if(_iconoCache[clase]) return _iconoCache[clase];
  try{
    const sonda = document.createElement('i');
    sonda.className = 'ti ' + clase;
    sonda.style.cssText = 'position:absolute;left:-9999px;top:0;';
    document.body.appendChild(sonda);
    const est = getComputedStyle(sonda, '::before');
    const car = (est.content || '').replace(/^["']|["']$/g, '');
    const familia = est.fontFamily || getComputedStyle(sonda).fontFamily;
    sonda.remove();
    if(car && car !== 'none'){
      _iconoCache[clase] = { car, familia };
      return _iconoCache[clase];
    }
  }catch(e){}
  return { car: '', familia: '' };
}

function accionDeslizar(direccion){
  const cfg = state.mailSwipe || {};
  return (direccion === 'izq' ? cfg.izquierda : cfg.derecha)
      || (direccion === 'izq' ? 'papelera' : 'archivar');   // por defecto
}
const _swMeta = {
  papelera: { icono: 'ti-trash',   texto: 'Papelera', color: 'var(--alta)',  fn: id => deleteEmail(id) },
  archivar: { icono: 'ti-archive', texto: 'Archivar', color: 'var(--baja)',  fn: id => archiveEmail(id) },
  spam:     { icono: 'ti-alert-octagon', texto: 'Spam', color: 'var(--media)', fn: id => marcarComoSpam(id) },
  destacar: { icono: 'ti-star',    texto: 'Destacar', color: 'var(--media)', fn: (id, mid) => destacarDesdeLista(mid, id) },
};

document.addEventListener('touchstart', e => {
  const fila = e.target.closest('.gmail-list-item');
  if(!fila || e.touches.length !== 1) return;
  const t = e.touches[0];
  _sw = { fila, x0: t.clientX, y0: t.clientY, dx: 0, decidido: false, horizontal: false };
}, { passive: true });

document.addEventListener('touchmove', e => {
  if(!_sw || e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - _sw.x0, dy = t.clientY - _sw.y0;

  // Se decide una sola vez si el gesto es horizontal o vertical
  if(!_sw.decidido){
    if(Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    _sw.decidido = true;
    _sw.horizontal = Math.abs(dx) > Math.abs(dy) * 1.4;
    if(_sw.horizontal) _sw.fila.classList.add('deslizando');
  }
  if(!_sw.horizontal) return;

  _sw.dx = dx;
  const accion = accionDeslizar(dx < 0 ? 'izq' : 'der');
  const meta = _swMeta[accion] || _swMeta.papelera;
  const pasado = Math.abs(dx) >= SWIPE_UMBRAL;

  const ico = iconoComoTexto(meta.icono);
  _sw.fila.style.transform = `translateX(${dx}px)`;
  _sw.fila.style.setProperty('--sw-color', meta.color);
  _sw.fila.style.setProperty('--sw-fuente', ico.familia || 'inherit');
  _sw.fila.dataset.swLado = dx < 0 ? 'izq' : 'der';
  _sw.fila.dataset.swChar = ico.car || (meta.texto || '').slice(0, 1);
  _sw.fila.classList.toggle('sw-listo', pasado);
}, { passive: true });

document.addEventListener('touchend', () => {
  if(!_sw) return;
  const { fila, dx, horizontal } = _sw;
  _sw = null;
  fila.classList.remove('deslizando');
  fila.style.transform = '';
  if(!horizontal || Math.abs(dx) < SWIPE_UMBRAL){ fila.classList.remove('sw-listo'); return; }

  const accion = accionDeslizar(dx < 0 ? 'izq' : 'der');
  const meta = _swMeta[accion] || _swMeta.papelera;
  // Se aparta antes de actuar, para que el gesto se sienta inmediato
  fila.style.transition = 'transform .18s, opacity .18s';
  fila.style.transform = `translateX(${dx < 0 ? -400 : 400}px)`;
  fila.style.opacity = '0';
  setTimeout(() => meta.fn(fila.dataset.tid, fila.dataset.id), 160);
}, { passive: true });

// ---- Configuración del gesto ----
function renderConfigDeslizar(){
  const el = document.getElementById('swipeCfg'); if(!el) return;
  const cfg = state.mailSwipe || {};
  const opciones = lado => Object.entries(_swMeta).map(([k, m]) =>
    `<option value="${k}" ${(cfg[lado] || (lado === 'izquierda' ? 'papelera' : 'archivar')) === k ? 'selected' : ''}>${m.texto}</option>`).join('');
  el.innerHTML = `
    <div class="cfg-fields">
      <label>Al deslizar hacia la izquierda</label>
      <select onchange="guardarDeslizar('izquierda', this.value)">${opciones('izquierda')}</select>
      <label style="margin-top:8px;">Al deslizar hacia la derecha</label>
      <select onchange="guardarDeslizar('derecha', this.value)">${opciones('derecha')}</select>
    </div>`;
}
function guardarDeslizar(lado, valor){
  state.mailSwipe = state.mailSwipe || {};
  state.mailSwipe[lado] = valor;
  saveSettings();
  setStatus('Gesto guardado.');
}
