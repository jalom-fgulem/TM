// Clasificación automática del correo
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.
//
// Idea: mirar los últimos cientos de correos, agruparlos por el dominio de quien
// escribe y proponer una clasificación. NADA se mueve sin que lo apruebes: la
// pantalla enseña la propuesta y tú marcas qué aceptas.
//
// Lo que se crea al aceptar son ETIQUETAS Y FILTROS DE GMAIL DE VERDAD, no un
// apaño de esta aplicación. Por eso siguen funcionando con la app cerrada, en el
// Gmail del ordenador y en el iPhone.

const CATEGORIAS = {
  publicidad: { etiqueta: 'Publicidad', icono: 'ti-speakerphone', color: '#EA580C',
                titulo: 'Publicidad', ayuda: 'Boletines y envíos masivos con enlace de baja' },
  viajes:     { etiqueta: 'Viajes',     icono: 'ti-plane',        color: '#0891B2',
                titulo: 'Viajes',     ayuda: 'Reservas de hotel, vuelos y trenes' },
  noticias:   { etiqueta: 'Noticias',   icono: 'ti-news',         color: '#5B4B9B',
                titulo: 'Noticias',   ayuda: 'Prensa y titulares' }
};

// Dominios que se reconocen sin necesidad de adivinar nada
const DOMINIOS_VIAJES = ['booking.com','airbnb.com','airbnb.es','renfe.com','iberia.com','vueling.com',
  'ryanair.com','easyjet.com','expedia.com','edreams.com','edreams.es','trivago.com','kayak.com',
  'tripadvisor.com','hoteles.com','logitravel.com','rumbo.es','halcon-viajes.es','alsa.es','ouigo.com',
  'avis.com','hertz.com','europcar.es','cabify.com','uber.com','trainline.es','omio.com'];

const DOMINIOS_NOTICIAS = ['elmundo.es','elpais.com','abc.es','lavanguardia.com','elconfidencial.com',
  'eldiario.es','20minutos.es','larazon.es','expansion.com','cincodias.com','elespanol.com',
  'publico.es','infolibre.es','okdiario.com','elperiodico.com','diariodeleon.es','leonoticias.com',
  'europapress.es','efe.com','rtve.es','cadenaser.com','ondacero.es','cope.es','nytimes.com',
  'ft.com','economist.com','elmundo.com','marca.com','as.com','elespanol.es'];

// Palabras que delatan un envío comercial cuando no hay cabecera de baja
const PISTAS_PUBLICIDAD = /\b(newsletter|bolet[ií]n|promoci[oó]n|oferta[s]?|descuento|rebajas|black friday|cyber monday|no-?reply|noreply|marketing|campa[nñ]a|suscr[ií]b)\b/i;

let _analisisCorreo = null;    // resultado del último análisis

// ---- Análisis ----
async function analizarCorreoParaClasificar(){
  if(!googleToken){ setStatus('Conecta con Google primero.'); return; }
  pintarAnalisisCargando('Leyendo tus últimos correos…');

  try{
    // Se miran los últimos 200 de la bandeja: suficiente para ver el patrón
    const ids = await _idsParaAnalizar(200);
    if(!ids.length){ pintarAnalisisCargando('No hay correos que analizar.'); return; }

    pintarAnalisisCargando(`Analizando ${ids.length} correos…`);
    const cabeceras = 'metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe';
    const mensajes = [];
    // De 25 en 25, para no lanzar 200 peticiones a la vez
    for(let i = 0; i < ids.length; i += 25){
      const trozo = ids.slice(i, i + 25);
      const res = await Promise.all(trozo.map(id =>
        fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&${cabeceras}`,
          { headers: { Authorization: `Bearer ${googleToken}` } })
          .then(r => r.ok ? r.json() : null).catch(() => null)
      ));
      res.filter(Boolean).forEach(m => mensajes.push(m));
      pintarAnalisisCargando(`Analizando ${Math.min(i + 25, ids.length)} de ${ids.length}…`);
    }

    _analisisCorreo = agruparRemitentes(mensajes);
    pintarPropuestaClasificacion();
  }catch(e){
    pintarAnalisisCargando('No se pudo analizar el correo. Revisa la conexión.');
  }
}

async function _idsParaAnalizar(cuantos){
  const ids = [];
  let token = null;
  while(ids.length < cuantos){
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:inbox&maxResults=100'
      + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${googleToken}` } });
    if(!r.ok) break;
    const d = await r.json();
    (d.messages || []).forEach(m => ids.push(m.id));
    token = d.nextPageToken;
    if(!token) break;
  }
  return ids.slice(0, cuantos);
}

// ---- Agrupación y decisión ----
function dominioDe(cabeceraFrom){
  const correo = emBareAddress(cabeceraFrom || '');
  const d = (correo.split('@')[1] || '').toLowerCase();
  // "news.booking.com" cuenta como booking.com
  const partes = d.split('.');
  if(partes.length > 2) return partes.slice(-2).join('.');
  return d;
}

function categoriaDe(dominio, mensajes){
  if(DOMINIOS_VIAJES.includes(dominio)) return 'viajes';
  if(DOMINIOS_NOTICIAS.includes(dominio)) return 'noticias';
  // La cabecera de baja es obligatoria en los envíos masivos legales: es la
  // señal más fiable que hay para distinguir publicidad de correo personal.
  const conBaja = mensajes.filter(m => emHeader(m, 'List-Unsubscribe')).length;
  if(conBaja >= Math.max(1, Math.ceil(mensajes.length * 0.6))) return 'publicidad';
  const asuntos = mensajes.map(m => emHeader(m, 'Subject') || '').join(' ');
  const remite = mensajes.map(m => emHeader(m, 'From') || '').join(' ');
  if(PISTAS_PUBLICIDAD.test(asuntos + ' ' + remite)) return 'publicidad';
  return null;
}

function agruparRemitentes(mensajes){
  const porDominio = new Map();
  mensajes.forEach(m => {
    const from = emHeader(m, 'From');
    const dom = dominioDe(from);
    if(!dom) return;
    if(!porDominio.has(dom)) porDominio.set(dom, { dominio: dom, mensajes: [], nombres: new Set() });
    const g = porDominio.get(dom);
    g.mensajes.push(m);
    const n = (from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim();
    if(n) g.nombres.add(n);
  });

  const grupos = [];
  porDominio.forEach(g => {
    // Regla de oro: si es alguien de tu CRM, no se toca jamás
    const esContacto = g.mensajes.some(m => typeof contactoPorRemitente === 'function'
      && contactoPorRemitente(emHeader(m, 'From')));
    if(esContacto) return;
    // Ni tus propias direcciones
    if(composeAliasDisponibles().some(a => (a.sendAsEmail || '').toLowerCase().endsWith('@' + g.dominio))) return;

    const cat = categoriaDe(g.dominio, g.mensajes);
    if(!cat) return;
    grupos.push({
      dominio: g.dominio,
      categoria: cat,
      cuantos: g.mensajes.length,
      nombre: [...g.nombres][0] || g.dominio,
      aceptado: true
    });
  });
  grupos.sort((a, b) => b.cuantos - a.cuantos);
  return grupos;
}

// ---- Pantalla ----
function pintarAnalisisCargando(texto){
  const el = document.getElementById('clasifPanel');
  if(el) el.innerHTML = `<p class="help"><span class="gm-giro" style="display:inline-block;vertical-align:-2px;margin-right:7px;"></span>${escapeHtml(texto)}</p>`;
}

function pintarPropuestaClasificacion(){
  const el = document.getElementById('clasifPanel'); if(!el) return;
  const grupos = _analisisCorreo || [];
  if(!grupos.length){
    el.innerHTML = '<p class="help">No he encontrado remitentes que encajen con claridad en publicidad, viajes o noticias. Tu bandeja está limpia de envíos masivos, o llegan desde direcciones que también usas para trabajar.</p>';
    return;
  }

  const porCat = {};
  grupos.forEach(g => { (porCat[g.categoria] = porCat[g.categoria] || []).push(g); });

  el.innerHTML = `
    <p class="help">Esto es lo que he encontrado. Desmarca lo que no quieras y pulsa el botón:
      se crearán las etiquetas en Gmail y una regla por remitente, de modo que a partir de
      ahora se aparten solos de la bandeja. <strong>Nada de lo que ya tienes se borra.</strong></p>
    ${Object.keys(CATEGORIAS).filter(c => porCat[c]).map(c => `
      <div class="clasif-cat">
        <div class="clasif-cat-cab">
          <i class="ti ${CATEGORIAS[c].icono}" style="color:${CATEGORIAS[c].color};" aria-hidden="true"></i>
          <span class="clasif-cat-nombre">${escapeHtml(CATEGORIAS[c].titulo)}</span>
          <span class="clasif-cat-n">${porCat[c].reduce((t, g) => t + g.cuantos, 0)} correos</span>
        </div>
        <p class="help" style="margin:0 0 7px;">${escapeHtml(CATEGORIAS[c].ayuda)}</p>
        ${porCat[c].map(g => `
          <label class="clasif-fila">
            <input type="checkbox" ${g.aceptado ? 'checked' : ''}
                   onchange="marcarGrupoClasif('${escapeAttr(g.dominio)}', this.checked)">
            <span class="clasif-dom">${escapeHtml(g.nombre)}</span>
            <span class="clasif-detalle">${escapeHtml(g.dominio)} · ${g.cuantos}</span>
          </label>`).join('')}
      </div>`).join('')}
    <label class="regla-check" style="margin-top:12px;">
      <input type="checkbox" id="clasifRetro" checked> Ordenar también los correos que ya tengo
    </label>
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
      <button class="btn-primary btn-small" onclick="aplicarClasificacion()">Crear etiquetas y reglas</button>
      <button class="btn-ghost btn-small" onclick="analizarCorreoParaClasificar()">Volver a analizar</button>
    </div>`;
}

function marcarGrupoClasif(dominio, valor){
  const g = (_analisisCorreo || []).find(x => x.dominio === dominio);
  if(g) g.aceptado = valor;
}

// ---- Aplicación ----
async function _etiquetaGmail(nombre){
  const ya = (gmailUserLabels || []).find(l => l.name === nombre);
  if(ya) return ya.id;
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    method: 'POST',
    headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre, labelListVisibility: 'labelShow', messageListVisibility: 'show' })
  });
  if(!r.ok) throw new Error('No se pudo crear la etiqueta ' + nombre);
  const l = await r.json();
  gmailUserLabels.push(l);
  return l.id;
}

async function aplicarClasificacion(){
  const elegidos = (_analisisCorreo || []).filter(g => g.aceptado);
  if(!elegidos.length){ setStatus('No has dejado ningún remitente marcado.'); return; }
  const retroactivo = document.getElementById('clasifRetro')?.checked;

  pintarAnalisisCargando('Creando etiquetas y reglas en Gmail…');
  const resumen = { reglas: 0, movidos: 0, fallos: [] };

  try{
    // Una etiqueta por categoría, creada solo si hace falta
    const idsEtiqueta = {};
    for(const c of new Set(elegidos.map(g => g.categoria))){
      idsEtiqueta[c] = await _etiquetaGmail(CATEGORIAS[c].etiqueta);
    }

    for(const g of elegidos){
      const idEtiqueta = idsEtiqueta[g.categoria];
      try{
        const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/filters', {
          method: 'POST',
          headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            criteria: { from: '@' + g.dominio },
            action: { addLabelIds: [idEtiqueta], removeLabelIds: ['INBOX'] }
          })
        });
        if(r.ok) resumen.reglas++;
        else resumen.fallos.push(g.dominio);
      }catch(e){ resumen.fallos.push(g.dominio); }

      if(retroactivo){
        const movidos = await _ordenarLosDeAntes(g.dominio, idEtiqueta);
        resumen.movidos += movidos;
      }
      pintarAnalisisCargando(`Aplicando… ${resumen.reglas} de ${elegidos.length}`);
    }

    await fetchGmailLabels();
    if(typeof fetchGmailFiltros === 'function') await fetchGmailFiltros();
    if(currentView === 'correo') loadGmailWidget();

    const el = document.getElementById('clasifPanel');
    if(el) el.innerHTML = `
      <p class="google-connected">✓ Listo</p>
      <p class="help">Se han creado <strong>${resumen.reglas} reglas</strong>${retroactivo ? ` y se han apartado <strong>${resumen.movidos} correos</strong> que ya tenías` : ''}.
        A partir de ahora esos remitentes van directos a su etiqueta sin pasar por la bandeja.
        ${resumen.fallos.length ? `<br>No se pudo con: ${escapeHtml(resumen.fallos.join(', '))}.` : ''}</p>
      <p class="help">Puedes revisar o deshacer cualquier regla en <strong>Reglas de correo</strong>, aquí mismo.</p>
      <button class="btn-ghost btn-small" style="margin-top:8px;" onclick="analizarCorreoParaClasificar()">Analizar otra vez</button>`;
    setStatus('Clasificación aplicada.');
  }catch(e){
    pintarAnalisisCargando('No se pudo completar: ' + (e.message || 'error inesperado'));
  }
}

// Aparta de la bandeja los correos que ya estaban, de 500 en 500 como máximo
async function _ordenarLosDeAntes(dominio, idEtiqueta){
  try{
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('in:inbox from:@' + dominio)}&maxResults=500`,
      { headers: { Authorization: `Bearer ${googleToken}` } });
    if(!r.ok) return 0;
    const ids = ((await r.json()).messages || []).map(m => m.id);
    if(!ids.length) return 0;
    const lote = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, addLabelIds: [idEtiqueta], removeLabelIds: ['INBOX'] })
    });
    return lote.ok ? ids.length : 0;
  }catch(e){ return 0; }
}
