-- Cierra un cabo suelto de 20260730200000_cerrojo_registro.sql.
--
-- Supabase concede EXECUTE sobre las funciones nuevas de "public" a los roles
-- anon y authenticated por privilegios por defecto. Ese permiso no se quita con
-- un "revoke from public": hay que nombrarlos.
--
-- En la práctica el riesgo era nulo (Postgres rechaza llamar directamente a una
-- función de disparador), pero aparecía en el linter de seguridad y no hay
-- motivo para dejar expuesto por la API algo que solo debe disparar el propio
-- motor al insertar en auth.users.

revoke all on function public.exigir_email_en_lista() from anon;
revoke all on function public.exigir_email_en_lista() from authenticated;
