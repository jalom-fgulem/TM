// Reglas de correo (filtros de Gmail): listar, crear y borrar
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.
//
// Aviso sobre la interfaz de Gmail: los filtros NO se pueden modificar, solo
// crear y borrar. "Editar" aquí significa borrar el viejo y crear uno nuevo.

let gmailFiltros = [];

async function fetchGmailFiltros(){
  if(!googleToken) return;
  try{
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/filters',
      { headers: { Authorization: `Bearer ${googleToken}` } });
    if(r.status === 401){ await handleGoogleExpired(); return; }
    if(r.status === 403){ _sendAsSinPermiso = true; renderReglasConfig(); return; }
    if(!r.ok) return;
    const d = await r.json();
    gmailFiltros = d.filter || [];
    renderReglasConfig();
  }catch(e){}
}

function etiquetaPorId(id){
  if(id === 'INBOX') return 'Bandeja de entrada';
  if(id === 'UNREAD') return 'No leído';
  if(id === 'STARRED') return 'Destacado';
  if(id === 'SPAM') return 'Spam';
  if(id === 'TRASH') return 'Papelera';
  if(id === 'IMPORTANT') return 'Importante';
  const l = (gmailUserLabels || []).find(x => x.id === id);
  return l ? l.name : id;
}

// Traduce la regla a lenguaje llano
function descripcionRegla(f){
  const c = f.criteria || {}, a = f.action || {};
  const si = [];
  if(c.from) si.push(`viene de <b>${escapeHtml(c.from)}</b>`);
  if(c.to) si.push(`va dirigido a <b>${escapeHtml(c.to)}</b>`);
  if(c.subject) si.push(`el asunto contiene <b>${escapeHtml(c.subject)}</b>`);
  if(c.query) si.push(`contiene <b>${escapeHtml(c.query)}</b>`);
  if(c.negatedQuery) si.push(`NO contiene <b>${escapeHtml(c.negatedQuery)}</b>`);
  if(c.hasAttachment) si.push('tiene archivos adjuntos');

  const entonces = [];
  (a.addLabelIds || []).forEach(id => {
    if(id === 'STARRED') entonces.push('lo destaca');
    else if(id === 'TRASH') entonces.push('lo manda a la papelera');
    else if(id === 'IMPORTANT') entonces.push('lo marca como importante');
    else entonces.push(`le pone la etiqueta <b>${escapeHtml(etiquetaPorId(id))}</b>`);
  });
  (a.removeLabelIds || []).forEach(id => {
    if(id === 'INBOX') entonces.push('lo archiva sin pasar por la bandeja');
    else if(id === 'UNREAD') entonces.push('lo marca como leído');
    else if(id === 'SPAM') entonces.push('nunca lo manda a spam');
    else if(id === 'IMPORTANT') entonces.push('lo marca como no importante');
    else entonces.push(`le quita la etiqueta <b>${escapeHtml(etiquetaPorId(id))}</b>`);
  });
  if(a.forward) entonces.push(`lo reenvía a <b>${escapeHtml(a.forward)}</b>`);

  return {
    si: si.length ? si.join(' y ') : 'cualquier correo',
    entonces: entonces.length ? entonces.join(', ') : '(sin acción)'
  };
}

// ---- Panel de configuración ----
function renderReglasConfig(){
  const el = document.getElementById('reglasList'); if(!el) return;
  if(_sendAsSinPermiso){
    el.innerHTML = '<p class="google-aviso">Falta autorizar el acceso a la configuración de tu correo. Ve a Configuración → Google → Volver a autorizar.</p>';
    return;
  }
  if(!gmailFiltros.length){
    el.innerHTML = '<p class="help">No tienes reglas creadas. Las que crees aquí funcionan también en Gmail, porque son las suyas.</p>';
    return;
  }
  el.innerHTML = gmailFiltros.map(f => {
    const d = descripcionRegla(f);
    return `<div class="regla-item">
      <div class="regla-texto">
        <div><span class="regla-et">Si</span> ${d.si}</div>
        <div><span class="regla-et">Entonces</span> ${d.entonces}</div>
      </div>
      <button class="btn-ghost btn-small" onclick="borrarRegla('${escapeAttr(f.id)}')">Eliminar</button>
    </div>`;
  }).join('');
}

// ---- Crear ----
function abrirEditorRegla(prefill){
  const p = prefill || {};
  const usuario = (gmailUserLabels || []).filter(l => l.type === 'user')
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal" style="max-width:560px;">
        <h3>Nueva regla de correo</h3>
        <p class="help">Se crea en tu cuenta de Gmail, así que actuará también cuando abras el correo desde otro sitio.</p>

        <p class="regla-seccion">Si el correo…</p>
        <div class="field"><label>Viene de</label><input type="text" id="rgFrom" value="${escapeAttr(p.from || '')}" placeholder="nombre@dominio.es"></div>
        <div class="field"><label>Va dirigido a</label><input type="text" id="rgTo" value="${escapeAttr(p.to || '')}" placeholder="Opcional"></div>
        <div class="field"><label>El asunto contiene</label><input type="text" id="rgSubject" value="${escapeAttr(p.subject || '')}" placeholder="Opcional"></div>
        <div class="field"><label>Contiene las palabras</label><input type="text" id="rgQuery" value="" placeholder="Opcional"></div>
        <div class="field"><label class="regla-check"><input type="checkbox" id="rgAdjunto"> Tiene archivos adjuntos</label></div>

        <p class="regla-seccion">Entonces…</p>
        <div class="field">
          <label>Ponerle la etiqueta</label>
          <select id="rgEtiqueta">
            <option value="">— Ninguna —</option>
            ${usuario.map(l => `<option value="${escapeAttr(l.id)}">${escapeHtml(l.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field regla-acciones">
          <label class="regla-check"><input type="checkbox" id="rgArchivar"> Archivarlo (que no pase por la bandeja)</label>
          <label class="regla-check"><input type="checkbox" id="rgLeido"> Marcarlo como leído</label>
          <label class="regla-check"><input type="checkbox" id="rgDestacar"> Destacarlo</label>
          <label class="regla-check"><input type="checkbox" id="rgNuncaSpam"> No mandarlo nunca a spam</label>
          <label class="regla-check"><input type="checkbox" id="rgBorrar"> Mandarlo a la papelera</label>
        </div>

        <p class="help">⚠️ La regla solo actúa sobre los correos que lleguen a partir de ahora. Google no permite aplicarla a los que ya tienes; para eso hay que hacerlo desde Gmail.</p>

        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="guardarRegla()">Crear regla</button>
        </div>
      </div>
    </div>`;
}

async function guardarRegla(){
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const chk = id => { const el = document.getElementById(id); return el ? el.checked : false; };

  const criteria = {};
  if(val('rgFrom')) criteria.from = val('rgFrom');
  if(val('rgTo')) criteria.to = val('rgTo');
  if(val('rgSubject')) criteria.subject = val('rgSubject');
  if(val('rgQuery')) criteria.query = val('rgQuery');
  if(chk('rgAdjunto')) criteria.hasAttachment = true;

  if(!Object.keys(criteria).length){
    setStatus('Indica al menos una condición, o la regla afectaría a todo tu correo.');
    return;
  }

  const addLabelIds = [], removeLabelIds = [];
  if(val('rgEtiqueta')) addLabelIds.push(val('rgEtiqueta'));
  if(chk('rgDestacar')) addLabelIds.push('STARRED');
  if(chk('rgBorrar')) addLabelIds.push('TRASH');
  if(chk('rgArchivar')) removeLabelIds.push('INBOX');
  if(chk('rgLeido')) removeLabelIds.push('UNREAD');
  if(chk('rgNuncaSpam')) removeLabelIds.push('SPAM');

  if(!addLabelIds.length && !removeLabelIds.length){
    setStatus('Indica al menos una acción.');
    return;
  }

  const action = {};
  if(addLabelIds.length) action.addLabelIds = addLabelIds;
  if(removeLabelIds.length) action.removeLabelIds = removeLabelIds;

  try{
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/filters', {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ criteria, action })
    });
    if(r.status === 401){ await handleGoogleExpired(); return; }
    if(!r.ok){
      const err = await r.json().catch(() => ({}));
      setStatus('No se pudo crear la regla: ' + ((err.error && err.error.message) || ('HTTP ' + r.status)));
      return;
    }
    closeModal();
    await fetchGmailFiltros();
    setStatus('Regla creada.');
  }catch(e){ setStatus('Error de red al crear la regla.'); }
}

function borrarRegla(id){
  showConfirm('¿Eliminar esta regla? Dejará de aplicarse a los correos que lleguen.', async () => {
    closeModal();
    try{
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/settings/filters/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${googleToken}` }
      });
      if(r.status === 401){ await handleGoogleExpired(); return; }
      if(!r.ok && r.status !== 204){ setStatus('No se pudo eliminar la regla.'); return; }
      gmailFiltros = gmailFiltros.filter(f => f.id !== id);
      renderReglasConfig();
      setStatus('Regla eliminada.');
    }catch(e){ setStatus('Error de red.'); }
  });
}

// Atajo desde un correo abierto: crea la regla ya con el remitente puesto
function crearReglaDesdeCorreo(msgId){
  const m = (_currentThread?.messages || []).find(x => x.id === msgId);
  if(!m){ setStatus('Abre primero un correo.'); return; }
  abrirEditorRegla({ from: emBareAddress(emHeader(m, 'From')) });
}
