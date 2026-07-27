-- Custodia del "pase de renovación" (refresh token) de Google.
--
-- Esta tabla NUNCA debe ser accesible desde el navegador: el refresh token
-- permite pedir acceso a Gmail/Drive/Calendar indefinidamente. Por eso:
--   1) RLS activado y SIN ninguna política -> nadie pasa el filtro
--   2) REVOKE explícito de los permisos que Supabase concede por defecto
-- Solo el rol service_role (que usa la Edge Function, en servidor) puede leerla.

create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

-- Sin políticas: ni anon ni authenticated pueden ver ni escribir nada.
revoke all on public.google_tokens from anon;
revoke all on public.google_tokens from authenticated;
