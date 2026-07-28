// Etiquetas de correo: árbol plegable, favoritos, fichas rápidas y búsqueda
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.
//
// Gmail anida las etiquetas con barras en el nombre ("Empleo/Ofertas"), así que
// la jerarquía sale de ahí: no hay que configurarla, ya la tienes montada.

let _gruposPlegados = new Set();   // rutas de grupos cerrados
let _contadoresEtiqueta = {};      // sin leer por etiqueta, cargado bajo demanda

function favoritasLista(){ return state.mailFavLabels || (state.mailFavLabels = []); }
function esFavorita(nombre){ return favoritasLista().includes(nombre); }

function toggleFavorita(nombre, ev){
  if(ev){ ev.stopPropagation(); ev.preventDefault(); }
  const fav = favoritasLista();
  const i = fav.indexOf(nombre);
  if(i >= 0) fav.splice(i, 1); else fav.push(nombre);
  saveSettings();
  renderGmailLabelBtns();
  if(currentView === 'correo') actualizarFichasEtiqueta();
}

// ---- Árbol a partir de los nombres con barras ----
function construirArbolEtiquetas(labels){
  const raiz = {};
  labels.slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .forEach(l => {
      const partes = l.name.split('/');
      let nivel = raiz;
      partes.forEach((parte, i) => {
        const ruta = partes.slice(0, i + 1).join('/');
        if(!nivel[parte]) nivel[parte] = { nombre: parte, ruta, hijos: {}, label: null };
        if(i === partes.length - 1) nivel[parte].label = l;
        nivel = nivel[parte].hijos;
      });
    });
  return raiz;
}

function pintarNodosEtiqueta(nodos, nivel){
  return Object.values(nodos).map(n => {
    const hijos = Object.keys(n.hijos).length;
    const plegado = _gruposPlegados.has(n.ruta);
    const activo = currentEmailQuery === 'label:' + n.ruta;
    const color = n.label && n.label.color && n.label.color.backgroundColor;
    const sinLeer = _contadoresEtiqueta[n.ruta];
    const sangria = 8 + nivel * 13;

    const fila = `
      <div class="gmail-sb-item ${activo ? 'active' : ''}" style="padding-left:${sangria}px;"
           ${n.label ? `data-label-id="${escapeAttr(n.label.id)}" data-label-name="${escapeAttr(n.nombre)}"` : ''}
           onclick="${n.label ? `setEmailQuery('label:${escapeAttr(n.ruta)}')` : `toggleGrupoEtiqueta('${escapeAttr(n.ruta)}')`}">
        ${hijos ? `<button class="gmail-sb-flecha ${plegado ? '' : 'abierta'}" onclick="event.stopPropagation();toggleGrupoEtiqueta('${escapeAttr(n.ruta)}')" title="${plegado ? 'Desplegar' : 'Plegar'}"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>`
                : '<span class="gmail-sb-flecha hueco"></span>'}
        ${color ? `<span class="gmail-sb-dot" style="background:${color};"></span>` : `<i class="ti ti-tag" aria-hidden="true"></i>`}
        <span class="gmail-sb-nombre">${escapeHtml(n.nombre)}</span>
        ${sinLeer ? `<span class="gmail-sb-cont">${sinLeer}</span>` : ''}
        ${n.label ? `<button class="gmail-sb-fav ${esFavorita(n.ruta) ? 'on' : ''}" onclick="toggleFavorita('${escapeAttr(n.ruta)}',event)" title="${esFavorita(n.ruta) ? 'Quitar de favoritas' : 'Marcar como favorita'}"><i class="ti ti-star${esFavorita(n.ruta) ? '-filled' : ''}" aria-hidden="true"></i></button>` : ''}
      </div>`;

    const dentro = (hijos && !plegado) ? pintarNodosEtiqueta(n.hijos, nivel + 1) : '';
    return fila + dentro;
  }).join('');
}

function toggleGrupoEtiqueta(ruta){
  if(_gruposPlegados.has(ruta)) _gruposPlegados.delete(ruta);
  else _gruposPlegados.add(ruta);
  state.mailCollapsed = [..._gruposPlegados];
  saveSettings();
  renderGmailLabelBtns();
}

// ---- Barra lateral ----
function renderGmailSidebarHTML(){
  const sistema = [
    { q: 'in:inbox',    icon: 'ti-inbox',   name: 'Recibidos' },
    { q: 'is:unread',   icon: 'ti-mail',    name: 'No leídos' },
    { q: 'is:starred',  icon: 'ti-star',    name: 'Destacados' },
    { q: 'in:sent',     icon: 'ti-send',    name: 'Enviados' },
    { q: 'in:drafts',   icon: 'ti-file',    name: 'Borradores' },
    { q: 'in:trash',    icon: 'ti-trash',   name: 'Papelera' },
    { q: 'in:spam',     icon: 'ti-alert-octagon', name: 'Spam' },
  ];
  const sisHtml = sistema.map(s => `
    <div class="gmail-sb-item ${currentEmailQuery === s.q ? 'active' : ''}" onclick="setEmailQuery('${s.q}')">
      <span class="gmail-sb-flecha hueco"></span>
      <i class="ti ${s.icon}" aria-hidden="true"></i>
      <span class="gmail-sb-nombre">${escapeHtml(s.name)}</span>
      ${s.q === 'in:inbox' && _contadoresEtiqueta.INBOX ? `<span class="gmail-sb-cont">${_contadoresEtiqueta.INBOX}</span>` : ''}
    </div>`).join('');

  // Favoritas arriba, para tenerlas a mano
  const fav = favoritasLista().filter(n => (gmailUserLabels || []).some(l => l.name === n));
  const favHtml = fav.length ? `
    <div class="gmail-sb-sep"></div>
    <div class="gmail-sb-section">Favoritas</div>
    ${fav.map(n => `
      <div class="gmail-sb-item ${currentEmailQuery === 'label:' + n ? 'active' : ''}"
           data-label-id="${escapeAttr((gmailUserLabels.find(l=>l.name===n)||{}).id||'')}" data-label-name="${escapeAttr(n.split('/').pop())}"
           onclick="setEmailQuery('label:${escapeAttr(n)}')">
        <span class="gmail-sb-flecha hueco"></span>
        <i class="ti ti-star-filled" style="color:var(--media);" aria-hidden="true"></i>
        <span class="gmail-sb-nombre">${escapeHtml(n.split('/').pop())}</span>
        ${_contadoresEtiqueta[n] ? `<span class="gmail-sb-cont">${_contadoresEtiqueta[n]}</span>` : ''}
      </div>`).join('')}` : '';

  const usuario = (gmailUserLabels || []).filter(l => l.type === 'user');
  const arbolHtml = usuario.length ? `
    <div class="gmail-sb-sep"></div>
    <div class="gmail-sb-section">Etiquetas</div>
    ${pintarNodosEtiqueta(construirArbolEtiquetas(usuario), 0)}` : '';

  return sisHtml + favHtml + arbolHtml;
}

// ---- Fichas rápidas sobre la lista ----
function renderFichasEtiqueta(){
  const fav = favoritasLista().filter(n => (gmailUserLabels || []).some(l => l.name === n));
  const todas = `<button class="gm-ficha ${currentEmailQuery === 'in:inbox' ? 'on' : ''}" onclick="setEmailQuery('in:inbox')">Todo</button>`;
  if(!fav.length){
    return `<div class="gm-fichas">${todas}<span class="gm-fichas-ayuda">Marca etiquetas con la estrella para tenerlas aquí</span></div>`;
  }
  return `<div class="gm-fichas">${todas}${fav.map(n => `
    <button class="gm-ficha ${currentEmailQuery === 'label:' + n ? 'on' : ''}"
      data-label-id="${escapeAttr((gmailUserLabels.find(l=>l.name===n)||{}).id||'')}" data-label-name="${escapeAttr(n.split('/').pop())}"
      onclick="setEmailQuery('label:${escapeAttr(n)}')">${escapeHtml(n.split('/').pop())}</button>`).join('')}</div>`;
}
function actualizarFichasEtiqueta(){
  const el = document.getElementById('gmFichas');
  if(el) el.outerHTML = renderFichasEtiqueta().replace('<div class="gm-fichas"', '<div class="gm-fichas" id="gmFichas"');
}

// ---- Búsqueda ----
function buscarCorreo(ev){
  if(ev && ev.key && ev.key !== 'Enter') return;
  const input = document.getElementById('gmBuscar');
  const texto = input ? input.value.trim() : '';
  setEmailQuery(texto || 'in:inbox');
}
function limpiarBusqueda(){
  const input = document.getElementById('gmBuscar');
  if(input) input.value = '';
  setEmailQuery('in:inbox');
}

// ---- Etiquetar un correo ----
function abrirSelectorEtiquetas(msgId){
  const msg = (_currentThread?.messages || []).find(m => m.id === msgId);
  if(!msg){ setStatus('Abre primero un correo.'); return; }
  const puestas = new Set(msg.labelIds || []);
  const usuario = (gmailUserLabels || []).filter(l => l.type === 'user');
  if(!usuario.length){ setStatus('No tienes etiquetas creadas en Gmail.'); return; }

  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal" style="max-width:480px;">
        <h3>Etiquetas del correo</h3>
        <p class="help">Marca las que quieras aplicar a este mensaje.</p>
        <div class="et-lista">
          ${usuario.sort((a,b)=>a.name.localeCompare(b.name,'es')).map(l => `
            <label class="et-op">
              <input type="checkbox" value="${escapeAttr(l.id)}" ${puestas.has(l.id) ? 'checked' : ''}>
              <span>${escapeHtml(l.name)}</span>
            </label>`).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="aplicarEtiquetas('${msgId}')">Aplicar</button>
        </div>
      </div>
    </div>`;
}

async function aplicarEtiquetas(msgId){
  const msg = (_currentThread?.messages || []).find(m => m.id === msgId);
  if(!msg) return;
  const marcadas = [...document.querySelectorAll('.et-lista input:checked')].map(i => i.value);
  const usuarioIds = (gmailUserLabels || []).filter(l => l.type === 'user').map(l => l.id);
  const antes = (msg.labelIds || []).filter(id => usuarioIds.includes(id));

  const añadir = marcadas.filter(id => !antes.includes(id));
  const quitar = antes.filter(id => !marcadas.includes(id));
  if(!añadir.length && !quitar.length){ closeModal(); return; }

  try{
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/modify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ addLabelIds: añadir, removeLabelIds: quitar })
    });
    if(r.status === 401){ handleGoogleExpired(); return; }
    if(!r.ok){ setStatus('No se pudieron aplicar las etiquetas.'); return; }
    const actualizado = await r.json();
    msg.labelIds = actualizado.labelIds || msg.labelIds;
    closeModal();
    renderThreadPanel();
    setStatus('Etiquetas actualizadas.');
  }catch(e){ setStatus('Error de red al etiquetar.'); }
}

// ---- Contadores de sin leer ----
// La lista de etiquetas no trae los contadores: hay que pedirlos uno a uno.
// Se piden solo los de la bandeja y los favoritos, para no lanzar decenas de
// peticiones en cada carga.
async function cargarContadoresEtiqueta(){
  if(!googleToken) return;
  const fav = favoritasLista().filter(n => (gmailUserLabels || []).some(l => l.name === n));
  const ids = ['INBOX', ...fav.map(n => (gmailUserLabels.find(l => l.name === n) || {}).id).filter(Boolean)];
  await Promise.all(ids.map(async id => {
    try{
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${id}`,
        { headers: { Authorization: `Bearer ${googleToken}` } });
      if(!r.ok) return;
      const d = await r.json();
      const clave = id === 'INBOX' ? 'INBOX' : d.name;
      _contadoresEtiqueta[clave] = d.messagesUnread || 0;
    }catch(e){}
  }));
  renderGmailLabelBtns();
}

// ============================================================
//  ANCHOS DE COLUMNA AJUSTABLES
//
//  Los anchos viven en dos variables de estilo que lee la rejilla, y se
//  guardan en los ajustes para que se mantengan entre sesiones y dispositivos.
// ============================================================

const GM_ANCHOS = { sb: { min: 130, max: 420, def: 170 }, list: { min: 220, max: 620, def: 280 } };

function aplicarAnchosCorreo(){
  const l = state.mailLayout || {};
  const cap = (v, c) => Math.min(Math.max(v || c.def, c.min), c.max);
  document.documentElement.style.setProperty('--gm-sb',   cap(l.sb,   GM_ANCHOS.sb)   + 'px');
  document.documentElement.style.setProperty('--gm-list', cap(l.list, GM_ANCHOS.list) + 'px');
}

// Eventos de puntero (no de ratón): valen igual para ratón, dedo y lápiz.
// La captura evita perder el arrastre si mueves rápido y sales del tirador.
document.addEventListener('pointerdown', e => {
  const tirador = e.target.closest('.gm-tirador');
  if(!tirador) return;
  e.preventDefault();

  const cual = tirador.dataset.col;
  const cfg = GM_ANCHOS[cual];
  if(!cfg) return;
  const variable = cual === 'sb' ? '--gm-sb' : '--gm-list';

  const inicioX = e.clientX;
  const actual = parseInt(getComputedStyle(document.documentElement).getPropertyValue(variable)) || cfg.def;

  try{ tirador.setPointerCapture(e.pointerId); }catch(err){}
  tirador.classList.add('arrastrando');
  document.body.classList.add('gm-redimensionando');

  const mover = ev => {
    const nuevo = Math.min(Math.max(actual + (ev.clientX - inicioX), cfg.min), cfg.max);
    document.documentElement.style.setProperty(variable, nuevo + 'px');
  };
  const soltar = () => {
    tirador.removeEventListener('pointermove', mover);
    tirador.removeEventListener('pointerup', soltar);
    tirador.removeEventListener('pointercancel', soltar);
    try{ tirador.releasePointerCapture(e.pointerId); }catch(err){}
    tirador.classList.remove('arrastrando');
    document.body.classList.remove('gm-redimensionando');
    // Se guarda al soltar, no en cada píxel
    state.mailLayout = state.mailLayout || {};
    state.mailLayout[cual] = parseInt(getComputedStyle(document.documentElement).getPropertyValue(variable));
    saveSettings();
  };
  tirador.addEventListener('pointermove', mover);
  tirador.addEventListener('pointerup', soltar);
  tirador.addEventListener('pointercancel', soltar);
});

// Doble clic en un tirador devuelve la columna a su ancho original
document.addEventListener('dblclick', e => {
  const tirador = e.target.closest('.gm-tirador');
  if(!tirador) return;
  const cual = tirador.dataset.col;
  state.mailLayout = state.mailLayout || {};
  delete state.mailLayout[cual];
  aplicarAnchosCorreo();
  saveSettings();
  setStatus('Ancho restablecido.');
});
