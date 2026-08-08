// Gestor de firmas de correo
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.
//
// Gmail solo expone UNA firma por dirección de envío en su interfaz de
// programación: las varias firmas con nombre que se pueden crear desde la web
// de Gmail no son accesibles desde fuera. Por eso las firmas se gestionan aquí,
// guardadas junto al resto de ajustes.
//
// Cada firma: { id, nombre, html, alias, porDefecto }
//   alias      -> dirección de envío a la que se asocia ('' = cualquiera)
//   porDefecto -> se inserta sola al abrir el redactor

function firmasLista(){ return state.signatures || (state.signatures = []); }

// Firma que corresponde a una dirección de envío concreta.
//
// Se busca de lo más concreto a lo más general, y NO hace falta marcar nada
// "por defecto": si sólo tienes una firma, esa es la que se usa. La regla es
// "una firma por dirección, y si esa dirección no tiene la suya, la principal".
function firmaParaAlias(email){
  const lista = firmasLista();
  if(!lista.length) return null;
  const e = (email || '').toLowerCase();
  const suya   = f => (f.alias || '').toLowerCase() === e && e;
  const general = f => !(f.alias || '').trim();

  // Última red: la firma de tu dirección principal. A propósito NO se recurre a
  // la de otro alias cualquiera: firmarías como FGULEM un correo salido de la
  // dirección de la Universidad, o al revés.
  const principal = (typeof emMyAddress === 'function' ? emMyAddress() : '').toLowerCase();
  const deLaPrincipal = f => principal && (f.alias || '').toLowerCase() === principal;

  return lista.find(f => suya(f) && f.porDefecto)         // la de esta dirección, preferida
      || lista.find(suya)                                  // la de esta dirección
      || lista.find(f => general(f) && f.porDefecto)        // la general preferida
      || lista.find(general)                                // cualquier general
      || lista.find(f => deLaPrincipal(f) && f.porDefecto)  // la de tu cuenta principal
      || lista.find(deLaPrincipal)
      || null;
}

// Qué firma se usaría para cada una de tus direcciones. Se enseña en los
// ajustes para que se vea de un vistazo, sin tener que probar escribiendo.
function resumenFirmasPorAlias(){
  const alias = (typeof composeAliasDisponibles === 'function') ? composeAliasDisponibles() : [];
  return alias.map(a => ({ email: a.sendAsEmail, firma: firmaParaAlias(a.sendAsEmail) }));
}

// ---- Panel de configuración ----
function renderFirmasConfig(){
  const el = document.getElementById('firmasList'); if(!el) return;
  const lista = firmasLista();
  if(!lista.length){
    el.innerHTML = '<p class="help">No hay firmas todavía. Crea una, o impórtala de Gmail si ya la tienes allí.</p>';
    return;
  }
  const resumen = resumenFirmasPorAlias();
  const cabecera = resumen.length ? `
    <div class="firma-resumen">
      <p class="sect-h" style="margin:0 0 7px;">Qué firma se usa en cada dirección</p>
      ${resumen.map(r => `<div class="firma-resumen-fila">
        <span class="fr-dir">${escapeHtml(r.email)}</span>
        <span class="fr-usa">${r.firma ? escapeHtml(r.firma.nombre || 'Sin nombre') : '— ninguna —'}</span>
      </div>`).join('')}
    </div>` : '';

  el.innerHTML = cabecera + lista.map(f => `
    <div class="firma-item">
      <div class="firma-item-head">
        <span class="firma-item-nombre">${escapeHtml(f.nombre || 'Sin nombre')}</span>
        ${f.porDefecto ? '<span class="firma-badge">Preferida</span>' : ''}
        <span class="firma-badge alias">${f.alias ? escapeHtml(f.alias) : 'Cualquier dirección'}</span>
      </div>
      <div class="firma-item-previa">${f.html || ''}</div>
      <div class="firma-item-acciones">
        <button class="btn-ghost btn-small" onclick="editarFirma('${f.id}')">Editar</button>
        ${f.porDefecto ? '' : `<button class="btn-ghost btn-small" onclick="marcarFirmaPorDefecto('${f.id}')">Preferir esta</button>`}
        <button class="btn-ghost btn-small" onclick="borrarFirma('${f.id}')">Eliminar</button>
      </div>
    </div>`).join('');
}

function editarFirma(id){
  const lista = firmasLista();
  const f = id ? lista.find(x => x.id === id) : null;
  const alias = (typeof composeAliasDisponibles === 'function') ? composeAliasDisponibles() : [];
  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal" style="max-width:760px;">
        <h3>${f ? 'Editar firma' : 'Nueva firma'}</h3>
        <div class="field">
          <label>Nombre (solo para que la reconozcas)</label>
          <input type="text" id="fmNombre" value="${escapeAttr(f ? f.nombre : '')}" placeholder="Ej.: FGULEM completa, Respuesta breve…">
        </div>
        <div class="field">
          <label>Dirección de envío asociada</label>
          <select id="fmAlias">
            <option value="">Cualquiera (firma general)</option>
            ${alias.map(a => `<option value="${escapeAttr(a.sendAsEmail)}" ${f && f.alias === a.sendAsEmail ? 'selected' : ''}>${escapeHtml(a.sendAsEmail)}</option>`).join('')}
          </select>
          <p class="help" style="margin-top:5px;">Si eliges una dirección, esta firma se usará al escribir desde ella.
            Si la dejas en «Cualquiera», servirá para las direcciones que no tengan firma propia.</p>
        </div>
        <div class="field">
          <label><input type="checkbox" id="fmDefecto" ${f && f.porDefecto ? 'checked' : ''}> Preferir esta si hay varias para la misma dirección</label>
          <p class="help" style="margin-top:5px;">No hace falta marcarlo para que la firma se use: sólo decide cuál gana si tienes más de una.</p>
        </div>
        <div class="field">
          <label>Contenido</label>
          <div class="firma-editor-toolbar">
            <button type="button" onclick="firmaFormato('bold')" title="Negrita"><b>B</b></button>
            <button type="button" onclick="firmaFormato('italic')" title="Cursiva"><i>I</i></button>
            <button type="button" onclick="firmaFormato('underline')" title="Subrayado"><u>U</u></button>
            <button type="button" onclick="firmaEnlace()" title="Enlace"><i class="ti ti-link" aria-hidden="true"></i></button>
            <button type="button" onclick="firmaImagen()" title="Imagen (logotipo)"><i class="ti ti-photo" aria-hidden="true"></i></button>
            <button type="button" onclick="firmaPegarHTML()" title="Pegar código HTML">HTML</button>
          </div>
          <div class="firma-editor" id="fmHtml" contenteditable="true">${f ? f.html : ''}</div>
          <p class="help" style="margin-top:6px;">Para el logotipo usa una imagen alojada en una dirección web. Las imágenes pegadas desde el ordenador no viajan en el correo.</p>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="guardarFirma('${f ? f.id : ''}')">Guardar firma</button>
        </div>
      </div>
    </div>`;
}

function firmaFormato(cmd){
  document.getElementById('fmHtml').focus();
  document.execCommand(cmd, false, null);
}
function firmaEnlace(){
  const url = prompt('Dirección del enlace:', 'https://');
  if(!url) return;
  document.getElementById('fmHtml').focus();
  document.execCommand('createLink', false, url);
}
function firmaImagen(){
  const url = prompt('Dirección de la imagen (https://…):');
  if(!url) return;
  const el = document.getElementById('fmHtml');
  el.focus();
  // Inserción directa: la orden del navegador borraría los estilos
  const img = document.createElement('img');
  img.src = url; img.style.maxWidth = '200px'; img.style.height = 'auto'; img.alt = '';
  el.appendChild(img);
}
function firmaPegarHTML(){
  const el = document.getElementById('fmHtml');
  const actual = el.innerHTML;
  const nuevo = prompt('Pega aquí el código HTML de tu firma:', actual);
  if(nuevo === null) return;
  el.innerHTML = nuevo;
}

function guardarFirma(id){
  const nombre = document.getElementById('fmNombre').value.trim();
  const html = document.getElementById('fmHtml').innerHTML.trim();
  const alias = document.getElementById('fmAlias').value;
  const porDefecto = document.getElementById('fmDefecto').checked;
  if(!nombre){ setStatus('Ponle un nombre a la firma.'); return; }
  if(!html){ setStatus('La firma está vacía.'); return; }

  const lista = firmasLista();
  // Solo una por defecto para cada dirección
  if(porDefecto) lista.forEach(f => { if((f.alias||'') === alias) f.porDefecto = false; });

  if(id){
    const f = lista.find(x => x.id === id);
    if(f) Object.assign(f, { nombre, html, alias, porDefecto });
  } else {
    lista.push({ id: uid(), nombre, html, alias, porDefecto });
  }
  saveSettings();
  closeModal();
  renderFirmasConfig();
  setStatus('Firma guardada.');
}

function marcarFirmaPorDefecto(id){
  const lista = firmasLista();
  const f = lista.find(x => x.id === id); if(!f) return;
  lista.forEach(x => { if((x.alias||'') === (f.alias||'')) x.porDefecto = false; });
  f.porDefecto = true;
  saveSettings();
  renderFirmasConfig();
}

function borrarFirma(id){
  showConfirm('¿Eliminar esta firma?', () => {
    state.signatures = firmasLista().filter(f => f.id !== id);
    saveSettings();
    closeModal();
    renderFirmasConfig();
  });
}

// Trae la firma que Gmail sí deja leer, como punto de partida
function importarFirmasDeGmail(){
  const alias = (typeof googleSendAs !== 'undefined') ? googleSendAs : [];
  const conFirma = alias.filter(a => a.signature && a.signature.trim());
  if(!conFirma.length){
    setStatus(typeof _sendAsSinPermiso !== 'undefined' && _sendAsSinPermiso
      ? 'Falta autorizar el acceso a tus firmas de Gmail. Vuelve a conectar con Google.'
      : 'En Gmail no hay ninguna firma guardada para tus direcciones. Créala aquí con «+ Nueva firma».');
    return;
  }
  const lista = firmasLista();
  let nuevas = 0;
  conFirma.forEach(a => {
    if(lista.some(f => f.alias === a.sendAsEmail && f.origen === 'gmail')) return;
    lista.push({
      id: uid(),
      nombre: 'Gmail — ' + a.sendAsEmail,
      html: a.signature,
      alias: a.sendAsEmail,
      porDefecto: !lista.some(f => (f.alias||'') === a.sendAsEmail && f.porDefecto),
      origen: 'gmail'
    });
    nuevas++;
  });
  saveSettings();
  renderFirmasConfig();
  setStatus(nuevas ? `Importada${nuevas>1?'s':''} ${nuevas} firma${nuevas>1?'s':''} de Gmail.` : 'Ya estaban importadas.');
}
