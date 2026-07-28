// Guarda (o retira) la suscripción de notificaciones de un dispositivo.
//
// El navegador, al conceder el permiso, genera una dirección única a la que se
// le pueden enviar avisos. Esa dirección se guarda aquí, asociada al usuario.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''

const ALLOWED_ORIGINS = [
  'https://jalom-fgulem.github.io',
  'http://localhost:8934',
  'http://localhost:5176',
]

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('Origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'no_auth' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (userErr || !user) return json({ error: 'invalid_session' }, 401)

  const body = await req.json().catch(() => ({})) as Record<string, any>
  const action = typeof body.action === 'string' ? body.action : ''

  // La app necesita la clave pública para poder suscribirse
  if (action === 'config') {
    return json({ publicKey: VAPID_PUBLIC_KEY })
  }

  if (action === 'unsubscribe') {
    if (!body.endpoint) return json({ error: 'missing_endpoint' }, 400)
    await admin.from('push_subscriptions').delete()
      .eq('id', body.endpoint).eq('user_id', user.id)
    return json({ ok: true })
  }

  if (action === 'status') {
    const { count } = await admin.from('push_subscriptions')
      .select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    return json({ subscripciones: count ?? 0 })
  }

  // Alta por defecto
  const sub = body.subscription
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return json({ error: 'missing_subscription' }, 400)
  }

  const { error } = await admin.from('push_subscriptions').upsert({
    id: sub.endpoint,
    user_id: user.id,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: (req.headers.get('User-Agent') ?? '').slice(0, 300),
  })
  if (error) return json({ error: error.message }, 500)

  // Se prepara la memoria del vigilante para este usuario
  await admin.from('notif_state').upsert(
    { user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'user_id', ignoreDuplicates: true },
  )

  return json({ ok: true })
})
