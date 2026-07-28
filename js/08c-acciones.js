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
  const fila = document.querySelector(`.gmail-list-item[data-tid="${threadId}"]`);
  const sub = document.getElementById('thread-sub-' + threadId);
  if(sub) sub.remove();
  if(fila){
    const idMostrado = fila.dataset.id;
    if(selectedEmailId === idMostrado) selectNextEmail(idMostrado);
    fila.remove();
  }
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
