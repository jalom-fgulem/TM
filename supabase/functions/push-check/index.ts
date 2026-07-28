// Vigilante: revisa cada pocos minutos si hay algo que merezca un aviso al
// móvil (correo nuevo, reunión a punto de empezar, tareas vencidas) y lo envía.
//
// Se ejecuta solo, mediante una tarea programada en la base de datos. No lo
// llama el navegador: por eso comprueba una clave compartida en vez de sesión.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

const b64urlToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  return Uint8Array.from(b, c => c.charCodeAt(0))
}
const bytesToB64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Las claves se guardaron como punto público y escalar privado; la librería
// las quiere en formato JWK, así que se reconstruyen aquí.
function vapidJwks() {
  const pub = b64urlToBytes(VAPID_PUBLIC_KEY)      // 0x04 + x(32) + y(32)
  const x = bytesToB64url(pub.slice(1, 33))
  const y = bytesToB64url(pub.slice(33, 65))
  return {
    publicKey:  { kty: 'EC', crv: 'P-256', x, y, ext: true },
    privateKey: { kty: 'EC', crv: 'P-256', x, y, d: VAPID_PRIVATE_KEY, ext: true },
  }
}

// ---- Pase de Google a partir del de renovación custodiado ----
async function accessTokenDeGoogle(admin: any, userId: string): Promise<string | null> {
  const { data: fila } = await admin.from('google_tokens')
    .select('refresh_token').eq('user_id', userId).maybeSingle()
  if (!fila) return null
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: fila.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) return null
  const t = await r.json()
  return t.access_token ?? null
}

const gapi = (token: string) => (url: string) =>
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })

// ---- Qué avisar ----
type Aviso = { clave: string; titulo: string; cuerpo: string; url?: string }

async function avisosDeCorreo(get: any, estado: any): Promise<{ avisos: Aviso[]; sinLeer: number }> {
  const r = await get('https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX')
  if (!r.ok) return { avisos: [], sinLeer: estado?.last_unread ?? 0 }
  const d = await r.json()
  const sinLeer = d.messagesUnread ?? 0
  const antes = estado?.last_unread ?? 0
  if (sinLeer <= antes) return { avisos: [], sinLeer }

  // Se mira el más reciente para poner remitente y asunto en el aviso
  let titulo = `${sinLeer - antes} correo${sinLeer - antes > 1 ? 's nuevos' : ' nuevo'}`
  let cuerpo = `Tienes ${sinLeer} sin leer en la bandeja de entrada.`
  let destino = '/TM/'
  try {
    const lr = await get('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+in:inbox&maxResults=1')
    const ids = (await lr.json()).messages ?? []
    if (ids.length) {
      const mr = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${ids[0].id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)
      const m = await mr.json()
      const h = (n: string) => (m.payload?.headers ?? []).find((x: any) => x.name === n)?.value ?? ''
      const de = h('From').replace(/<[^>]+>/, '').replace(/"/g, '').trim()
      if (de) { titulo = de; cuerpo = h('Subject') || '(sin asunto)' }
      // Al tocar el aviso se abrirá esta conversación concreta
      destino = `/TM/#abrir=correo:${m.threadId ?? ids[0].threadId ?? ''}:${ids[0].id}`
    }
  } catch { /* el aviso genérico ya sirve */ }

  return { avisos: [{ clave: 'correo:' + sinLeer, titulo, cuerpo, url: destino }], sinLeer }
}

async function avisosDeReuniones(get: any, yaAvisados: Record<string, boolean>): Promise<Aviso[]> {
  const ahora = new Date()
  const hasta = new Date(ahora.getTime() + 20 * 60000)   // próximos 20 minutos
  const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
    + `?timeMin=${ahora.toISOString()}&timeMax=${hasta.toISOString()}`
    + '&singleEvents=true&orderBy=startTime&maxResults=5'
  const r = await get(url)
  if (!r.ok) return []
  const eventos = (await r.json()).items ?? []
  const out: Aviso[] = []
  for (const ev of eventos) {
    if (!ev.start?.dateTime) continue          // los de todo el día no avisan
    const clave = 'reunion:' + ev.id
    if (yaAvisados[clave]) continue
    const hora = new Date(ev.start.dateTime).toLocaleTimeString('es-ES',
      { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
    out.push({ clave, titulo: 'Reunión a las ' + hora, cuerpo: ev.summary ?? '(sin título)',
               url: `/TM/#abrir=reunion:${ev.id}` })
  }
  return out
}

async function avisosDeTareas(admin: any, yaAvisados: Record<string, boolean>): Promise<Aviso[]> {
  const hoy = new Date().toISOString().slice(0, 10)
  const { data: filas } = await admin.from('tasks').select('data')
  const vencidas = (filas ?? [])
    .map((f: any) => f.data)
    .filter((t: any) => t?.due && t.due < hoy && t.status !== 'hecha')
  if (!vencidas.length) return []
  // Un solo aviso al día, no uno por tarea
  const clave = 'tareas:' + hoy
  if (yaAvisados[clave]) return []
  return [{
    clave,
    titulo: `${vencidas.length} tarea${vencidas.length > 1 ? 's vencidas' : ' vencida'}`,
    cuerpo: vencidas.slice(0, 3).map((t: any) => t.title).join(' · '),
    url: '/TM/#abrir=tareas',
  }]
}

// ---- Envío ----
async function enviar(appServer: any, admin: any, subs: any[], aviso: Aviso) {
  for (const s of subs) {
    try {
      const suscriptor = appServer.subscribe({
        endpoint: s.id,
        keys: { p256dh: s.p256dh, auth: s.auth },
      })
      await suscriptor.pushTextMessage(JSON.stringify({
        title: aviso.titulo, body: aviso.cuerpo, url: aviso.url ?? '/TM/', tag: aviso.clave,
      }), {})
      await admin.from('push_subscriptions')
        .update({ last_ok_at: new Date().toISOString() }).eq('id', s.id)
    } catch (e) {
      const msg = String(e)
      // El dispositivo ya no acepta avisos: se retira para no reintentar siempre
      if (msg.includes('404') || msg.includes('410')) {
        await admin.from('push_subscriptions').delete().eq('id', s.id)
      }
    }
  }
}

Deno.serve(async (req: Request) => {
  // Solo lo invoca la tarea programada, con una clave compartida
  const clave = req.headers.get('X-Cron-Secret') ?? ''
  if (!CRON_SECRET || clave !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'no_autorizado' }), { status: 401 })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const resumen: Record<string, unknown> = { usuarios: 0, enviados: 0 }

  try {
    const appServer = await webpush.ApplicationServer.new({
      contactInformation: VAPID_SUBJECT,
      vapidKeys: await webpush.importVapidKeys(vapidJwks(), { extractable: false }),
    })

    const { data: subs } = await admin.from('push_subscriptions').select('*')
    if (!subs?.length) return new Response(JSON.stringify({ ...resumen, nota: 'sin suscripciones' }))

    // Agrupadas por usuario: un usuario puede tener varios dispositivos
    const porUsuario = new Map<string, any[]>()
    subs.forEach((s: any) => {
      if (!porUsuario.has(s.user_id)) porUsuario.set(s.user_id, [])
      porUsuario.get(s.user_id)!.push(s)
    })
    resumen.usuarios = porUsuario.size

    for (const [userId, dispositivos] of porUsuario) {
      const token = await accessTokenDeGoogle(admin, userId)
      if (!token) continue
      const get = gapi(token)

      const { data: estado } = await admin.from('notif_state')
        .select('*').eq('user_id', userId).maybeSingle()
      const yaAvisados: Record<string, boolean> = estado?.avisados ?? {}

      const { avisos: correo, sinLeer } = await avisosDeCorreo(get, estado)
      const reuniones = await avisosDeReuniones(get, yaAvisados)
      const tareas = await avisosDeTareas(admin, yaAvisados)
      const todos = [...correo, ...reuniones, ...tareas]

      for (const a of todos) {
        await enviar(appServer, admin, dispositivos, a)
        yaAvisados[a.clave] = true
        resumen.enviados = (resumen.enviados as number) + 1
      }

      // Se recorta la memoria para que no crezca sin fin
      const claves = Object.keys(yaAvisados)
      const recortado = claves.length > 200
        ? Object.fromEntries(claves.slice(-100).map(k => [k, true]))
        : yaAvisados

      await admin.from('notif_state').upsert({
        user_id: userId,
        last_unread: sinLeer,
        avisados: recortado,
        updated_at: new Date().toISOString(),
      })
    }

    return new Response(JSON.stringify(resumen), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
