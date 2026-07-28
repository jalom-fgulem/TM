-- Notificaciones al móvil.
--
-- push_subscriptions guarda la dirección única que genera el iPhone al dar
-- permiso. Igual que los pases de Google, no debe ser accesible desde el
-- navegador: RLS activo, sin políticas y sin permisos para anon ni
-- authenticated. Solo la entrega la Edge Function, que usa service_role.

create table if not exists public.push_subscriptions (
  id          text primary key,              -- la propia dirección de envío
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,                 -- claves de cifrado del dispositivo
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz                    -- último envío entregado con éxito
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
revoke all on public.push_subscriptions from authenticated;

-- Memoria del vigilante: qué se ha avisado ya, para no repetir el mismo aviso
-- en cada pasada. Una fila por usuario.
create table if not exists public.notif_state (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  last_history_id text,          -- último punto conocido del buzón
  last_unread     int default 0,
  avisados        jsonb default '{}'::jsonb,   -- ids ya notificados (reuniones, tareas)
  updated_at      timestamptz not null default now()
);

alter table public.notif_state enable row level security;
revoke all on public.notif_state from anon;
revoke all on public.notif_state from authenticated;
