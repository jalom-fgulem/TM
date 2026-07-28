// Agenda de direcciones y autocompletado al escribir destinatarios
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.
//
// La agenda se construye leyendo tu propio correo: a quién escribes (enviados)
// y quién te escribe (recibidos). No hace falta ningún permiso nuevo, y sale
// más completa que la lista de contactos guardados, porque recoge a todo aquel
// con quien tratas de verdad.

let _agendaOcupada = false;

function agendaLista(){ return state.mailAgenda || (state.mailAgenda = []); }

function agendaEdadEnDias(){
  if(!state.mailAgendaFecha) return 999;
  return (Date.now() - new Date(state.mailAgendaFecha).getTime()) / 86400000;
}

// Trocea las peticiones para no lanzar cientos a la vez
async function _porTandas(elementos, tam, fn){
  const salida = [];
  for(let i = 0; i < elementos.length; i += tam){
    const trozo = elementos.slice(i, i + tam);
    salida.push(...await Promise.all(trozo.map(fn)));
  }
  return salida;
}

async function _cabecerasDe(consulta, cuantos, cabeceras){
  const lr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(consulta)}&maxResults=${cuantos}`,
    { headers: { Authorization: `Bearer ${googleToken}` } });
  if(lr.status === 401){ await handleGoogleExpired(); return []; }
  if(!lr.ok) return [];
  const ids = (await lr.json()).messages || [];
  const param = cabeceras.map(h => 'metadataHeaders=' + h).join('&');
  return await _porTandas(ids, 15, async ({ id }) => {
    try{
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&${param}`,
        { headers: { Authorization: `Bearer ${googleToken}` } });
      if(!r.ok) return null;
      const m = await r.json();
      return m.payload?.headers || [];
    }catch(e){ return null; }
  });
}

async function construirAgendaCorreo(manual){
  if(!googleToken || _agendaOcupada) return;
  _agendaOcupada = true;
  const avisar = t => { const el = document.getElementById('agendaEstado'); if(el) el.innerHTML = t; };
  if(manual) avisar('<p class="help">Revisando tu correo…</p>');

  try{
    const yo = emBareAddress(emMyAddress());
    const mios = new Set([yo, ...(googleSendAs || []).map(a => a.sendAsEmail.toLowerCase())]);
    const cuenta = new Map();   // correo -> { nombre, veces }

    const anotar = (cadena, peso) => {
      emSplitAddresses(cadena || '').forEach(a => {
        const correo = emBareAddress(a);
        if(!correo || !correo.includes('@') || mios.has(correo)) return;
        if(/noreply|no-reply|notification|mailer-daemon|bounce/i.test(correo)) return;
        const nombre = a.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
        const ya = cuenta.get(correo) || { nombre: '', veces: 0 };
        // Se guarda el nombre más largo visto: suele ser el más completo
        if(nombre && nombre.length > ya.nombre.length && !nombre.includes('@')) ya.nombre = nombre;
        ya.veces += peso;
        cuenta.set(correo, ya);
      });
    };

    // A quien escribes cuenta el doble: es lo que de verdad quieres autocompletar
    const enviados = await _cabecerasDe('in:sent', 120, ['To', 'Cc']);
    enviados.filter(Boolean).forEach(hs => {
      anotar(hs.find(h => h.name === 'To')?.value, 2);
      anotar(hs.find(h => h.name === 'Cc')?.value, 2);
    });
    const recibidos = await _cabecerasDe('in:inbox', 80, ['From']);
    recibidos.filter(Boolean).forEach(hs => anotar(hs.find(h => h.name === 'From')?.value, 1));

    state.mailAgenda = [...cuenta.entries()]
      .map(([e, v]) => ({ e, n: v.nombre, v: v.veces }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 400);                     // se acota para no engordar los ajustes
    state.mailAgendaFecha = new Date().toISOString();
    saveSettings();

    if(manual) avisar(`<p class="google-connected">✓ ${state.mailAgenda.length} direcciones reconocidas</p>`);
    else setStatus(`Agenda de correo actualizada (${state.mailAgenda.length} direcciones).`);
  }catch(e){
    if(manual) avisar('<p class="google-aviso">No se pudo revisar el correo.</p>');
  }finally{ _agendaOcupada = false; }
}

function renderAgendaConfig(){
  const el = document.getElementById('agendaEstado'); if(!el) return;
  const n = agendaLista().length;
  const dias = Math.round(agendaEdadEnDias());
  el.innerHTML = n
    ? `<p class="google-connected">✓ ${n} direcciones reconocidas</p>
       <p class="help">Actualizada hace ${dias === 0 ? 'menos de un día' : dias + ' día' + (dias > 1 ? 's' : '')}.</p>`
    : '<p class="help">Todavía sin construir. Se hace sola al conectar, o púlsalo aquí.</p>';
}

// ============================================================
//  AUTOCOMPLETADO EN LOS CAMPOS DE DESTINATARIO
// ============================================================

let _acCampo = null, _acIndice = -1, _acOpciones = [];

// Devuelve el fragmento que se está escribiendo (lo que va tras la última coma)
function _acFragmento(input){
  const hasta = input.value.slice(0, input.selectionStart ?? input.value.length);
  const coma = hasta.lastIndexOf(',');
  return { texto: hasta.slice(coma + 1).trim(), desde: coma + 1 };
}

function _acBuscar(termino){
  const t = termino.toLowerCase();
  if(t.length < 2) return [];
  const yaPuestos = new Set(emSplitAddresses(_acCampo.value).map(emBareAddress));

  // Primero los del CRM, que son los que te importan de verdad
  const delCrm = (state.contacts || [])
    .filter(c => c.email && (contactFullName(c).toLowerCase().includes(t) || c.email.toLowerCase().includes(t)))
    .map(c => ({ e: c.email.toLowerCase(), n: contactFullName(c), crm: true, cargo: [c.cargo, c.empresa].filter(Boolean).join(' · ') }));

  const deAgenda = agendaLista()
    .filter(a => a.e.includes(t) || (a.n || '').toLowerCase().includes(t))
    .map(a => ({ e: a.e, n: a.n, v: a.v }));

  const vistos = new Set(delCrm.map(x => x.e));
  const juntos = [...delCrm, ...deAgenda.filter(a => !vistos.has(a.e))];
  return juntos.filter(x => !yaPuestos.has(x.e)).slice(0, 8);
}

function _acPintar(){
  let caja = document.getElementById('acLista');
  if(!_acOpciones.length){ if(caja) caja.remove(); return; }
  if(!caja){
    caja = document.createElement('div');
    caja.className = 'ac-lista'; caja.id = 'acLista';
    _acCampo.parentNode.appendChild(caja);
  }
  caja.innerHTML = _acOpciones.map((o, i) => `
    <button type="button" class="ac-op ${i === _acIndice ? 'sel' : ''}" onmousedown="event.preventDefault();acElegir(${i})">
      <span class="ac-nombre">${escapeHtml(o.n || o.e)}</span>
      <span class="ac-correo">${escapeHtml(o.e)}</span>
      ${o.crm ? `<span class="ac-crm"><i class="ti ti-address-book" aria-hidden="true"></i> CRM${o.cargo ? ' · ' + escapeHtml(o.cargo) : ''}</span>` : ''}
    </button>`).join('');
}

function acElegir(i){
  const o = _acOpciones[i]; if(!o || !_acCampo) return;
  const { desde } = _acFragmento(_acCampo);
  const antes = _acCampo.value.slice(0, desde);
  const resto = _acCampo.value.slice(_acCampo.selectionStart ?? _acCampo.value.length);
  const texto = o.n ? `${o.n} <${o.e}>` : o.e;
  _acCampo.value = (antes + (antes.trim() ? ' ' : '') + texto + ', ' + resto.trim()).replace(/,\s*,/g, ',');
  _acCampo.focus();
  const pos = (antes + (antes.trim() ? ' ' : '') + texto + ', ').length;
  _acCampo.setSelectionRange(pos, pos);
  _acCerrar();
}
function _acCerrar(){
  _acOpciones = []; _acIndice = -1;
  const c = document.getElementById('acLista'); if(c) c.remove();
}

document.addEventListener('input', e => {
  const campo = e.target;
  if(!campo.id || !['cpTo', 'cpCc', 'cpBcc'].includes(campo.id)) return;
  _acCampo = campo;
  _acOpciones = _acBuscar(_acFragmento(campo).texto);
  _acIndice = _acOpciones.length ? 0 : -1;
  _acPintar();
});

document.addEventListener('keydown', e => {
  if(!_acOpciones.length || !_acCampo || e.target !== _acCampo) return;
  if(e.key === 'ArrowDown'){ e.preventDefault(); _acIndice = (_acIndice + 1) % _acOpciones.length; _acPintar(); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); _acIndice = (_acIndice - 1 + _acOpciones.length) % _acOpciones.length; _acPintar(); }
  else if(e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); acElegir(_acIndice < 0 ? 0 : _acIndice); }
  else if(e.key === 'Escape'){ _acCerrar(); }
});

document.addEventListener('focusout', e => {
  if(e.target && ['cpTo', 'cpCc', 'cpBcc'].includes(e.target.id)) setTimeout(_acCerrar, 120);
});
