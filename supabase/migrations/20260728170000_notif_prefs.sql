-- Preferencias de aviso: qué notificar y a qué hora agrupar las tareas.
-- Se guardan junto a la memoria del vigilante, que es quien las consulta.
alter table public.notif_state
  add column if not exists prefs jsonb not null default '{}'::jsonb;
