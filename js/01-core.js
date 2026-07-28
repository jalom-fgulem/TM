// Constantes, estado, utilidades y capa de datos (Supabase)
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

const STORAGE_KEY = 'tablero-fgulem-datos';
const SUPABASE_URL = 'https://awnitqzydpqvbjxqgjfk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3cqXbZ0mntG4tGgqzVA3JQ_xNWHlmbJ';
const DEFAULT_AREAS = ['Desarrollo profesional','Formación y congresos','Transferencia e innovación','Encargos de gestión','Desarrollo digital','Servicios generales','Dirección / Transversal'];
const DEFAULT_TIPOS = ['Correo pendiente','Llamada','Reunión por montar','Tema general'];
const DEFAULT_PROFILE = { nombre:'', apellidos:'', alias:'', email:'', cargo:'' };
let state = { notes:[], tasks:[], areas:DEFAULT_AREAS.slice(), tipos:DEFAULT_TIPOS.slice(), projects:[], meetings:[], contacts:[], profile:{...DEFAULT_PROFILE} };
let currentPersonFilter = null;
let tempParticipants = [];
let meetingDraftStash = null;
let currentView = 'correo';   // la app abre directamente en el correo
let currentProjectId = null;
let currentUrgFilter = 'todas';
let expandedSubtasks = new Set();
let currentAreaFilter = 'todas';
let currentTipoFilter = 'todas';
let tempSubtasks = [];
let tempExpectedParticipants = [];
let tempLinkedTaskIds = [];
let tempSourceEmailId = null;
let tempDriveFiles = [];

const monthsEs = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function fmtDate(d){ const dt=new Date(d+'T00:00:00'); return dt.getDate()+' de '+monthsEs[dt.getMonth()]+' de '+dt.getFullYear(); }
function fmtDateShort(d){ const dt=new Date(d+'T00:00:00'); return dt.getDate()+' de '+monthsEs[dt.getMonth()]; }
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// Returns 'single'|'start'|'mid'|'end'|false for a task on a given dateStr
function taskSpanPos(t, dateStr){
  if(!t.due) return false;
  const s = t.start || t.due;
  if(dateStr < s || dateStr > t.due) return false;
  if(s === t.due || !t.start) return 'single';
  if(dateStr === s) return 'start';
  if(dateStr === t.due) return 'end';
  return 'mid';
}
document.getElementById('datebar').textContent = new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

function setStatus(msg){
  const el=document.getElementById('statusMsg'); el.textContent=msg;
  if(msg) setTimeout(()=>{ if(el.textContent===msg) el.textContent=''; },3500);
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function escapeHtml(s){ return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }
function getProj(id){ return state.projects.find(x=>x.id===id) || null; }
function projName(id){ const p=getProj(id); return p?p.name:null; }

// Cabeceras de acceso a la base de datos. Si hay sesión iniciada se usa el pase
// del usuario; así las tablas pueden exigir estar identificado en vez de estar
// abiertas a cualquiera.
function sbHeaders(extra){
  const token = (sbSession && sbSession.access_token) ? sbSession.access_token : SUPABASE_KEY;
  return Object.assign({ 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }, extra||{});
}
async function fetchTable(table, orderDir){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=data&order=id.${orderDir}`, {
    headers: sbHeaders()
  });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const rows = await res.json();
  return rows.map(r=>r.data);
}
async function upsertRow(table, id, data){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders({
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify([{ id, data, updated_at: new Date().toISOString() }])
  });
  if(!res.ok) setStatus('No se pudo guardar (HTTP '+res.status+'). Reintenta.');
}
async function deleteRow(table, id){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: sbHeaders()
  });
  if(!res.ok) setStatus('No se pudo borrar (HTTP '+res.status+'). Reintenta.');
}
function saveTaskRow(t){ return upsertRow('tasks', t.id, t); }
function deleteTaskRow(id){ return deleteRow('tasks', id); }
function saveProjectRow(p){ return upsertRow('projects', p.id, p); }
function deleteProjectRow(id){ return deleteRow('projects', id); }
function saveMeetingRow(m){ return upsertRow('meetings', m.id, m); }
function deleteMeetingRow(id){ return deleteRow('meetings', id); }
function saveContactRow(c){ return upsertRow('contacts', c.id, c); }
function deleteContactRow(id){ return deleteRow('contacts', id); }
function saveNoteRow(n){ return upsertRow('notes', n.id, n); }
function deleteNoteRow(id){ return deleteRow('notes', id); }
function saveSettings(){ return upsertRow('board', STORAGE_KEY, { areas: state.areas, tipos: state.tipos, profile: state.profile, calendarSelection: state.calendarSelection||{}, calendarConfig: state.calendarConfig||{}, kanbanOrder: state.kanbanOrder||{}, signatures: state.signatures||[], mailFavLabels: state.mailFavLabels||[], mailCollapsed: state.mailCollapsed||[], mailLayout: state.mailLayout||{}, mailAgenda: state.mailAgenda||[], mailAgendaFecha: state.mailAgendaFecha||null, mailSwipe: state.mailSwipe||{}, notifPrefs: state.notifPrefs||{} }); }

async function loadState(){
  setStatus('Cargando...');
  try{
    const [tasks, projects, meetings, contacts, notes, boardRes] = await Promise.all([
      fetchTable('tasks','desc'),
      fetchTable('projects','asc'),
      fetchTable('meetings','desc'),
      fetchTable('contacts','asc'),
      fetchTable('notes','desc'),
      fetch(`${SUPABASE_URL}/rest/v1/board?id=eq.${STORAGE_KEY}&select=data`, {
        headers: sbHeaders()
      }).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    ]);
    const settings = (boardRes && boardRes.length && boardRes[0].data) ? boardRes[0].data : {};
    state = {
      tasks, projects, meetings, contacts, notes,
      areas: (settings.areas && settings.areas.length) ? settings.areas : DEFAULT_AREAS.slice(),
      tipos: (settings.tipos && settings.tipos.length) ? settings.tipos : DEFAULT_TIPOS.slice(),
      profile: settings.profile || {...DEFAULT_PROFILE},
      calendarSelection: settings.calendarSelection || {},
      calendarConfig: settings.calendarConfig || {},
      signatures: settings.signatures || [],
      mailFavLabels: settings.mailFavLabels || [],
      mailCollapsed: settings.mailCollapsed || [],
      mailLayout: settings.mailLayout || {},
      mailAgenda: settings.mailAgenda || [],
      mailAgendaFecha: settings.mailAgendaFecha || null,
      mailSwipe: settings.mailSwipe || {},
      notifPrefs: settings.notifPrefs || {},
      kanbanOrder: settings.kanbanOrder || {}
    };
    state.tasks.forEach(t=>{ if(!t.subtasks) t.subtasks=[]; t.subtasks.forEach(s=>{ if(!s.children) s.children=[]; }); if(!t.linkedTaskIds) t.linkedTaskIds=[]; });
    state.projects.forEach(p=>{ if(!p.areas) p.areas=[]; if(!p.log) p.log=[]; if(p.active===undefined) p.active=true; });
    if(typeof aplicarAnchosCorreo === 'function') aplicarAnchosCorreo();
    setStatus('');
  }catch(e){
    setStatus('Error al cargar los datos.');
  }
  updateAppTitle();
  render();
}
