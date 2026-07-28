-- Tarea programada que despierta al vigilante de notificaciones.
--
-- pg_net permite que la base de datos haga llamadas de red; pg_cron las
-- programa. La clave compartida NO se escribe aquí: se guarda cifrada en la
-- caja fuerte de Supabase y se lee en el momento de la llamada, porque este
-- fichero vive en un repositorio público.
--
-- Requisito previo (se hace una sola vez, fuera de este fichero):
--   select vault.create_secret('<clave>', 'tm_cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule('tm_push_check') where exists (
  select 1 from cron.job where jobname = 'tm_push_check'
);

select cron.schedule(
  'tm_push_check',
  '*/3 * * * *',          -- 🔧 PERSONALIZAR: cada cuánto se comprueba
  $$
  select net.http_post(
    url     := 'https://awnitqzydpqvbjxqgjfk.supabase.co/functions/v1/push-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tm_cron_secret')
    ),
    timeout_milliseconds := 25000
  );
  $$
);
