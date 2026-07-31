-- Deshace 20260730200000_cerrojo_registro.sql
--
-- Este directorio NO lo aplica "supabase db push": son guiones de vuelta atrás
-- que se ejecutan a mano y solo si hace falta.
--
-- Ojo: al deshacerlo, cualquier cuenta de Google vuelve a poder registrarse si
-- además está activado "Allow new users to sign up" en el panel.

drop trigger if exists exigir_email_en_lista on auth.users;
drop function if exists public.exigir_email_en_lista();
drop table if exists public.allowed_emails;
