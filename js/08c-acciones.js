// Acciones sobre conversaciones: archivar, borrar, spam, mover — con deshacer
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.
//
// IMPORTANTE: todas actúan sobre la CONVERSACIÓN entera, no sobre un mensaje
// suelto. Antes se borraba solo el último mensaje del hilo, de modo que una
// conversación de dos correos reaparecía en cuanto se refrescaba la lista.

let _deshacerTimer = null;

// ---- Aviso con opción de deshacer ----
function mostrarDeshacer(mensaje, alDeshacer, segundos){
  segundos = segundos || 5;     // corto a propósito: no interrumpe el trabajo
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
  refrescarContadoresPronto();
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

// ============================================================
//  TIRAR HACIA ABAJO PARA ACTUALIZAR (móvil)
//
//  Estando arriba del todo, se arrastra la lista hacia abajo y al soltar se
//  recarga la bandeja. Convive con el gesto lateral de archivar/borrar: aquel
//  solo actúa cuando el movimiento es claramente horizontal, y este cuando es
//  claramente vertical y hacia abajo.
// ============================================================
const TIRON_UMBRAL = 72;      // cuánto hay que bajar para que cuente
const TIRON_TOPE   = 110;     // hasta dónde se deja estirar
let _tiron = null;

function _columnaDeLista(nodo){
  return nodo && nodo.closest ? nodo.closest('.gmail-list-col') : null;
}
function _avisoTiron(col){
  let el = col.querySelector('.gm-tiron');
  if(!el){
    el = document.createElement('div');
    el.className = 'gm-tiron';
    el.innerHTML = '<span class="gm-giro"></span><span class="gm-tiron-txt">Tira para actualizar</span>';
    col.insertBefore(el, col.firstChild);
  }
  return el;
}

document.addEventListener('touchstart', e => {
  if(!isMobile() || e.touches.length !== 1) return;
  const col = _columnaDeLista(e.target);
  if(!col || col.scrollTop > 2) return;
  _tiron = { col, y0: e.touches[0].clientY, x0: e.touches[0].clientX, dy: 0, activo: false };
}, { passive: true });

document.addEventListener('touchmove', e => {
  if(!_tiron || e.touches.length !== 1) return;
  const dy = e.touches[0].clientY - _tiron.y0;
  const dx = e.touches[0].clientX - _tiron.x0;

  if(!_tiron.activo){
    // Solo se toma el gesto si baja de verdad y no es un deslizamiento lateral
    if(dy < 12 || Math.abs(dx) > Math.abs(dy) * 0.8) { if(dy < -4 || Math.abs(dx) > 14) _tiron = null; return; }
    _tiron.activo = true;
    _tiron.aviso = _avisoTiron(_tiron.col);
  }
  e.preventDefault();                      // se apaga el rebote propio del móvil
  const recorrido = Math.min(dy * 0.55, TIRON_TOPE);
  _tiron.dy = recorrido;
  _tiron.col.style.transform = `translateY(${recorrido}px)`;
  _tiron.aviso.classList.toggle('listo', recorrido >= TIRON_UMBRAL);
  _tiron.aviso.querySelector('.gm-tiron-txt').textContent =
    recorrido >= TIRON_UMBRAL ? 'Suelta para actualizar' : 'Tira para actualizar';
}, { passive: false });

document.addEventListener('touchend', () => {
  if(!_tiron) return;
  const { col, dy, activo, aviso } = _tiron;
  _tiron = null;
  if(!activo) return;
  col.style.transition = 'transform .22s';
  col.style.transform = '';
  setTimeout(() => { col.style.transition = ''; }, 240);
  if(dy < TIRON_UMBRAL){ if(aviso) aviso.remove(); return; }

  if(aviso){
    aviso.classList.add('cargando');
    aviso.querySelector('.gm-tiron-txt').textContent = 'Actualizando…';
  }
  Promise.resolve(loadGmailWidget()).finally(() => {
    // loadGmailWidget repinta la lista entera, así que el aviso se va con ella
    col.querySelector('.gm-tiron')?.remove();
    setStatus('Bandeja actualizada.');
  });
}, { passive: true });

// ============================================================
//  SELECCIÓN MÚLTIPLE
//
//  Marcar varias conversaciones y actuar sobre todas de una vez. La papelera
//  y el archivado van conversación a conversación (no mensaje a mensaje), que
//  es como se comporta el resto de la aplicación, y con un único "deshacer"
//  para todo el lote.
// ============================================================
let _seleccion = new Set();

function alternarSeleccion(tid, marcado){
  if(marcado) _seleccion.add(tid); else _seleccion.delete(tid);
  document.querySelector(`.gmail-list-item[data-tid="${tid}"]`)?.classList.toggle('marcado', marcado);
  pintarBarraSeleccion();
}

function limpiarSeleccion(mantenerModo){
  _seleccion.clear();
  document.querySelectorAll('.gmail-list-item.marcado').forEach(f => f.classList.remove('marcado'));
  document.querySelectorAll('.gli-sel input:checked').forEach(c => { c.checked = false; });
  // Tras borrar o archivar se sigue en modo selección: lo normal es querer
  // marcar los siguientes. Solo se sale con el botón "Salir".
  if(!mantenerModo) document.body.classList.remove('modo-seleccion');
  pintarBarraSeleccion();
}

function seleccionarTodoVisible(){
  document.querySelectorAll('.gmail-list-item').forEach(f => {
    if(f.dataset.tid){ _seleccion.add(f.dataset.tid); f.classList.add('marcado'); }
  });
  document.querySelectorAll('.gli-sel input').forEach(c => { c.checked = true; });
  pintarBarraSeleccion();
}

function alternarModoSeleccion(){
  const activo = document.body.classList.toggle('modo-seleccion');
  if(activo) pintarBarraSeleccion();     // la barra aparece ya, explicando qué hacer
  else limpiarSeleccion();
}

function pintarBarraSeleccion(){
  const col = document.querySelector('.gmail-list-col');
  const modo = document.body.classList.contains('modo-seleccion');
  let barra = document.getElementById('gmBarraSel');
  if(!modo && !_seleccion.size){ if(barra) barra.remove(); return; }
  if(!col) return;
  if(!barra){
    barra = document.createElement('div');
    barra.id = 'gmBarraSel';
    barra.className = 'gm-barra-sel';
    const cab = col.querySelector('.gm-cabecera');
    cab ? cab.after(barra) : col.prepend(barra);
  }
  const n = _seleccion.size;
  barra.innerHTML = `
    <span class="gm-sel-n">${n ? `${n} seleccionado${n > 1 ? 's' : ''}` : 'Toca los correos que quieras'}</span>
    ${n ? `
    <button class="gm-sel-btn verde" onclick="archivarSeleccion()" title="Archivar" aria-label="Archivar los seleccionados"><i class="ti ti-archive" aria-hidden="true"></i><span>Archivar</span></button>
    <button class="gm-sel-btn rojo" onclick="borrarSeleccion()" title="Mover a la papelera" aria-label="Mover a la papelera los seleccionados"><i class="ti ti-trash" aria-hidden="true"></i><span>Borrar</span></button>` : ''}
    <button class="gm-sel-btn" onclick="seleccionarTodoVisible()" title="Seleccionar todos los de la lista" aria-label="Seleccionar todos">Todos</button>
    <button class="gm-sel-btn" onclick="limpiarSeleccion()" title="Salir de la selección" aria-label="Salir de la selección"><i class="ti ti-x" aria-hidden="true"></i> Salir</button>`;
}

// Ejecuta una acción sobre cada conversación marcada, de cinco en cinco para
// no lanzar cincuenta peticiones de golpe.
async function _porLotes(ids, tarea){
  const bien = [], mal = [];
  for(let i = 0; i < ids.length; i += 5){
    const trozo = ids.slice(i, i + 5);
    const res = await Promise.all(trozo.map(id => tarea(id).then(() => true).catch(() => false)));
    res.forEach((ok, j) => (ok ? bien : mal).push(trozo[j]));
  }
  return { bien, mal };
}

async function borrarSeleccion(){
  const ids = [..._seleccion];
  if(!ids.length || !googleToken) return;
  limpiarSeleccion(true);
  ids.forEach(sacarDeLaLista);
  const { bien, mal } = await _porLotes(ids, id => accionHilo(id, 'trash'));
  if(mal.length) setStatus(`${bien.length} a la papelera; ${mal.length} no se pudieron borrar.`);
  if(!bien.length) { loadGmailWidget(); return; }
  mostrarDeshacer(`${bien.length} conversacion${bien.length > 1 ? 'es' : ''} a la papelera.`, async () => {
    await _porLotes(bien, id => accionHilo(id, 'untrash'));
    loadGmailWidget();
    setStatus('Recuperadas de la papelera.');
  });
}

async function archivarSeleccion(){
  const ids = [..._seleccion];
  if(!ids.length || !googleToken) return;
  limpiarSeleccion(true);
  ids.forEach(sacarDeLaLista);
  const { bien, mal } = await _porLotes(ids, id => accionHilo(id, 'modify', { removeLabelIds: ['INBOX'] }));
  if(mal.length) setStatus(`${bien.length} archivadas; ${mal.length} no se pudieron archivar.`);
  if(!bien.length) { loadGmailWidget(); return; }
  mostrarDeshacer(`${bien.length} conversacion${bien.length > 1 ? 'es' : ''} archivada${bien.length > 1 ? 's' : ''}.`, async () => {
    await _porLotes(bien, id => accionHilo(id, 'modify', { addLabelIds: ['INBOX'] }));
    loadGmailWidget();
    setStatus('Devueltas a la bandeja.');
  });
}
