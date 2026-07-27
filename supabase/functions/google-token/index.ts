// Función de servidor que custodia el "pase de renovación" de Google.
//
// El navegador nunca ve el refresh_token. Solo puede pedir aquí un pase de
// acceso fresco (1 hora), y solo si va identificado con su sesión de Supabase.
//
// Dos acciones:
//   {action:'store', refresh_token}  -> guarda el pase de renovación (tras el login)
//   {}                               -> devuelve un access_token nuevo de Google
//   {action:'status'}                -> dice si hay pase guardado, sin devolverlo

import { createClient } from 'jsr:@supabase/supabase-js@2'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// 🔧 PERSONALIZAR: direcciones desde las que se permite llamar a esta función.
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
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return json({ error: 'server_not_configured' }, 500)
  }

  // 1. Identificar quién llama a partir de su sesión de Supabase.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'no_auth' }, 401)

  // service_role: se salta RLS, es la única vía de acceso a google_tokens.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (userErr || !user) return json({ error: 'invalid_session' }, 401)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''

  // 2. Guardar el pase de renovación recién obtenido en el login.
  if (action === 'store') {
    const refreshToken = body.refresh_token
    if (typeof refreshToken !== 'string' || !refreshToken) {
      return json({ error: 'missing_refresh_token' }, 400)
    }
    const { error } = await admin.from('google_tokens').upsert({
      user_id: user.id,
      refresh_token: refreshToken,
      updated_at: new Date().toISOString(),
    })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  // 3. Consultar si hay pase guardado (sin devolverlo nunca).
  const { data: row, error: readErr } = await admin
    .from('google_tokens')
    .select('refresh_token')
    .eq('user_id', user.id)
    .maybeSingle()

  if (readErr) return json({ error: readErr.message }, 500)
  if (action === 'status') return json({ connected: !!row })
  if (!row) return json({ error: 'not_connected' }, 404)

  // 4. Canjear el pase de renovación por un pase de acceso fresco.
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const tok = await res.json().catch(() => ({}))

  if (!res.ok) {
    // invalid_grant = el usuario revocó el permiso o Google invalidó el pase.
    // Lo borramos para que la app pida reconectar en vez de reintentar en bucle.
    if (tok?.error === 'invalid_grant') {
      await admin.from('google_tokens').delete().eq('user_id', user.id)
      return json({ error: 'reauth_required' }, 409)
    }
    return json({ error: tok?.error ?? 'google_error' }, 502)
  }

  return json({ access_token: tok.access_token, expires_in: tok.expires_in ?? 3600 })
})
