// Redacción de correo: nuevo, responder, responder a todos y reenviar
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

let _composeCtx = null;    // contexto del correo que se está redactando
let _currentEmailMsg = null; // último mensaje abierto en el panel de lectura

// ---- Utilidades de cabeceras ----
function emHeader(msg, nombre){
  const h = (msg && msg.payload && msg.payload.headers || [])
    .find(x => x.name.toLowerCase() === nombre.toLowerCase());
  return h ? h.value : '';
}
function emMyAddress(){
  return (sbSession && sbSession.user && sbSession.user.email) || '';
}
// Separa "Ana <a@x.es>, Luis <l@y.es>" en direcciones, respetando las comillas
function emSplitAddresses(str){
  if(!str) return [];
  const out=[]; let buf=''; let dentroComillas=false, dentroAngulo=false;
  for(const c of str){
    if(c === '"') dentroComillas = !dentroComillas;
    if(c === '<') dentroAngulo = true;
    if(c === '>') dentroAngulo = false;
    if(c === ',' && !dentroComillas && !dentroAngulo){ out.push(buf.trim()); buf=''; continue; }
    buf += c;
  }
  if(buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}
function emBareAddress(a){
  const m = a.match(/<([^>]+)>/);
  return (m ? m[1] : a).trim().toLowerCase();
}

// ---- Codificación para la API de Gmail ----
// Gmail espera el correo completo en base64url. Hay que cuidar los acentos:
// btoa() no admite caracteres fuera de Latin-1, así que primero pasamos a UTF-8.
function emB64(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function emB64Url(str){
  return emB64(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
// Asunto con acentos o eñes: hay que codificarlo según RFC 2047
function emEncodeSubject(s){
  return /^[\x00-\x7F]*$/.test(s || '') ? (s || '') : '=?UTF-8?B?' + emB64(s) + '?=';
}

function emBuildRaw(o){
  const l = [];
  l.push('To: ' + (o.to || ''));
  if(o.cc)  l.push('Cc: '  + o.cc);
  if(o.bcc) l.push('Bcc: ' + o.bcc);
  l.push('Subject: ' + emEncodeSubject(o.subject));
  if(o.inReplyTo){
    l.push('In-Reply-To: ' + o.inReplyTo);
    l.push('References: ' + (o.references ? o.references + ' ' + o.inReplyTo : o.inReplyTo));
  }
  l.push('MIME-Version: 1.0');
  l.push('Content-Type: text/html; charset="UTF-8"');
  l.push('Content-Transfer-Encoding: base64');
  l.push('');
  l.push(emB64(o.bodyHtml || '').replace(/(.{76})/g, '$1\r\n'));
  return emB64Url(l.join('\r\n'));
}

// ---- Cita del mensaje original ----
// Fecha completa, no relativa: en una cita "El ayer 09:15..." queda mal redactado.
function emQuoteDate(dateStr){
  try{
    const d = new Date(dateStr);
    if(isNaN(d)) return dateStr || '';
    return d.toLocaleDateString('es-ES', { day:'numeric', month:'long', year:'numeric' })
         + ' a las ' + d.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
  }catch(e){ return dateStr || ''; }
}
function emQuoteOriginal(msg){
  if(!msg) return '';
  const de = emHeader(msg, 'From');
  const fecha = emHeader(msg, 'Date');
  const cuerpo = extractEmailBody(msg.payload);
  const contenido = cuerpo.html
    ? cuerpo.html
    : '<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">' + escapeHtml(cuerpo.text || '') + '</pre>';
  return `<br><br><div style="color:#555;">El ${escapeHtml(emQuoteDate(fecha))}, ${escapeHtml(de)} escribió:</div>
    <blockquote style="border-left:2px solid #ccc;margin:6px 0 0;padding-left:12px;color:#555;">${contenido}</blockquote>`;
}

// ---- Apertura del redactor ----
// modo: 'nuevo' | 'responder' | 'responderTodos' | 'reenviar'
function openCompose(modo, prefill){
  if(!googleToken){ setStatus('Conecta con Google para poder enviar correo.'); return; }
  const msg = (modo === 'nuevo') ? null : _currentEmailMsg;
  if(modo !== 'nuevo' && !msg){ setStatus('Abre primero un correo.'); return; }

  const yo = emBareAddress(emMyAddress());
  let to = '', cc = '', asunto = '', cuerpo = '', inReplyTo = '', references = '', threadId = '';

  if(modo === 'nuevo'){
    to = (prefill && prefill.to) || '';
    asunto = (prefill && prefill.subject) || '';
    cuerpo = '<br>';
  } else {
    const asuntoOrig = emHeader(msg, 'Subject') || '(sin asunto)';
    inReplyTo  = emHeader(msg, 'Message-ID');
    references = emHeader(msg, 'References');

    if(modo === 'reenviar'){
      asunto = /^\s*(fwd|rv):/i.test(asuntoOrig) ? asuntoOrig : 'Fwd: ' + asuntoOrig;
      cuerpo = '<br><br>' + emQuoteOriginal(msg);
      inReplyTo = ''; references = '';   // reenviar abre conversación nueva
    } else {
      asunto = /^\s*re:/i.test(asuntoOrig) ? asuntoOrig : 'Re: ' + asuntoOrig;
      threadId = msg.threadId || '';
      // Reply-To manda sobre From si viene informado
      to = emHeader(msg, 'Reply-To') || emHeader(msg, 'From');
      if(modo === 'responderTodos'){
        const otros = [...emSplitAddresses(emHeader(msg, 'To')), ...emSplitAddresses(emHeader(msg, 'Cc'))]
          .filter(a => {
            const b = emBareAddress(a);
            return b !== yo && b !== emBareAddress(to);
          });
        cc = otros.join(', ');
      }
      cuerpo = '<br><br>' + emQuoteOriginal(msg);
    }
  }

  _composeCtx = { modo, inReplyTo, references, threadId };

  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this) closeCompose()">
      <div class="modal compose-modal">
        <h3>${modo === 'nuevo' ? 'Nuevo correo' : modo === 'reenviar' ? 'Reenviar' : modo === 'responderTodos' ? 'Responder a todos' : 'Responder'}</h3>
        <div class="compose-field">
          <label>Para</label>
          <input type="text" id="cpTo" value="${escapeAttr(to)}" placeholder="nombre@dominio.es, otro@dominio.es">
        </div>
        <div class="compose-field" id="cpCcRow" style="${cc ? '' : 'display:none;'}">
          <label>Cc</label>
          <input type="text" id="cpCc" value="${escapeAttr(cc)}">
        </div>
        <div class="compose-field" id="cpBccRow" style="display:none;">
          <label>Cco</label>
          <input type="text" id="cpBcc" value="">
        </div>
        <div class="compose-toggles">
          <button type="button" class="btn-link-small" onclick="toggleComposeField('cpCcRow')">Cc</button>
          <button type="button" class="btn-link-small" onclick="toggleComposeField('cpBccRow')">Cco</button>
        </div>
        <div class="compose-field">
          <label>Asunto</label>
          <input type="text" id="cpSubject" value="${escapeAttr(asunto)}">
        </div>
        <div class="compose-toolbar">
          <button type="button" onclick="composeFormat('bold')" title="Negrita"><b>B</b></button>
          <button type="button" onclick="composeFormat('italic')" title="Cursiva"><i>I</i></button>
          <button type="button" onclick="composeFormat('underline')" title="Subrayado"><u>U</u></button>
          <button type="button" onclick="composeFormat('insertUnorderedList')" title="Lista">&bull;</button>
          <button type="button" onclick="composeLink()" title="Insertar enlace">🔗</button>
        </div>
        <div class="compose-body" id="cpBody" contenteditable="true">${cuerpo}</div>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeCompose()">Cancelar</button>
          <button class="btn-primary" id="cpSendBtn" onclick="sendComposedEmail()">Enviar</button>
        </div>
      </div>
    </div>`;

  // El cursor al principio, encima de la cita
  const b = document.getElementById('cpBody');
  b.focus();
  const r = document.createRange();
  r.setStart(b, 0); r.collapse(true);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  if(modo === 'nuevo' && !to) document.getElementById('cpTo').focus();
}

function toggleComposeField(id){
  const el = document.getElementById(id);
  if(el) el.style.display = el.style.display === 'none' ? '' : 'none';
}
function composeFormat(cmd){
  document.getElementById('cpBody').focus();
  document.execCommand(cmd, false, null);
}
function composeLink(){
  const url = prompt('Dirección del enlace:');
  if(!url) return;
  document.getElementById('cpBody').focus();
  document.execCommand('createLink', false, url);
}
function closeCompose(){
  _composeCtx = null;
  document.getElementById('modalRoot').innerHTML = '';
}

// ---- Envío ----
async function sendComposedEmail(){
  const to = document.getElementById('cpTo').value.trim();
  if(!to){ setStatus('Falta el destinatario.'); return; }
  const cc = document.getElementById('cpCc').value.trim();
  const bcc = document.getElementById('cpBcc').value.trim();
  const subject = document.getElementById('cpSubject').value.trim();
  const bodyHtml = document.getElementById('cpBody').innerHTML;

  const btn = document.getElementById('cpSendBtn');
  btn.disabled = true; btn.textContent = 'Enviando…';

  const raw = emBuildRaw({
    to, cc, bcc, subject, bodyHtml,
    inReplyTo: _composeCtx ? _composeCtx.inReplyTo : '',
    references: _composeCtx ? _composeCtx.references : ''
  });
  const payload = { raw };
  if(_composeCtx && _composeCtx.threadId) payload.threadId = _composeCtx.threadId;

  async function intentar(){
    return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  try{
    let r = await intentar();
    if(r.status === 401){          // pase caducado: se renueva y se reintenta una vez
      await handleGoogleExpired();
      if(googleToken) r = await intentar();
    }
    if(!r.ok){
      const err = await r.json().catch(() => ({}));
      setStatus('No se pudo enviar: ' + ((err.error && err.error.message) || ('HTTP ' + r.status)));
      btn.disabled = false; btn.textContent = 'Enviar';
      return;
    }
    closeCompose();
    setStatus('Correo enviado.');
    if(currentView === 'correo') loadGmailWidget();
  }catch(e){
    setStatus('Error de red al enviar.');
    btn.disabled = false; btn.textContent = 'Enviar';
  }
}
