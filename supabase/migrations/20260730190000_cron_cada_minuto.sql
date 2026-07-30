-- El vigilante de notificaciones pasa a mirar cada minuto (antes, cada tres).
--
-- Motivo: con tres minutos, un correo podía tardar ese tiempo en avisarte al
-- móvil y la notificación se sentía con retraso. Al minuto, el aviso llega
-- prácticamente a la vez que el correo.
--
-- Coste: 1.440 ejecuciones al día en lugar de 480. Cada una es una consulta
-- ligera a Gmail (el contador de la bandeja) y solo hace más trabajo cuando
-- de verdad hay algo nuevo, así que sigue muy por debajo de los límites.
--
-- La clave compartida NO se escribe aquí: se lee de la caja fuerte de
-- Supabase, porque este fichero vive en un repositorio público.

select cron.unschedule('tm_push_check') where exists (
  select 1 from cron.job where jobname = 'tm_push_check'
);

select cron.schedule(
  'tm_push_check',
  '* * * * *',            -- 🔧 PERSONALIZAR: cada cuánto se comprueba
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
