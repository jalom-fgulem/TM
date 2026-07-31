-- Cerrojo de registro: solo pueden darse de alta las cuentas de una lista
-- blanca explícita.
--
-- El interruptor "Allow new users to sign up" del panel de Supabase ya está
-- desactivado, pero ese ajuste vive fuera del repositorio y puede volver a
-- activarse por descuido. Esto es un segundo cerrojo, independiente del panel
-- y versionado: aunque el alta se reabra, ninguna cuenta ajena entra.
--
-- La lista vive en una tabla, no dentro del código del disparador, para poder
-- ampliarla con un simple INSERT (desde el editor SQL o una Edge Function con
-- service_role) sin escribir una migración nueva.

-- ---------------------------------------------------------------- lista blanca
create table if not exists public.allowed_emails (
  email      text primary key,          -- siempre en minúsculas
  nota       text,                      -- para qué es esta cuenta
  created_at timestamptz not null default now()
);

comment on table public.allowed_emails is
  'Correos autorizados a registrarse. Lo consulta el disparador '
  'exigir_email_en_lista sobre auth.users. Solo accesible con service_role.';

-- Nadie desde el navegador: ni leer quién está autorizado.
alter table public.allowed_emails enable row level security;
revoke all on public.allowed_emails from anon;
revoke all on public.allowed_emails from authenticated;

-- Siembra: las cuentas que YA existen, para no dejar fuera al propietario.
-- No se escribe ningún correo literal aquí; se leen de auth.users.
insert into public.allowed_emails (email, nota)
select lower(u.email), 'cuenta ya existente al instalar el cerrojo'
  from auth.users u
 where u.email is not null
on conflict (email) do nothing;

-- ------------------------------------------------------------------ disparador
create or replace function public.exigir_email_en_lista()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is null
     or not exists (
       select 1 from public.allowed_emails a
        where a.email = lower(new.email)
     ) then
    raise exception 'Registro no permitido para esta cuenta: %',
      coalesce(new.email, '(sin correo)')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Nadie debe poder llamarla por la API: solo la dispara el motor al insertar.
-- (Los tres roles hacen falta: Supabase concede EXECUTE a anon y authenticated
-- por privilegios por defecto, y eso no lo quita el revoke a public.)
revoke all on function public.exigir_email_en_lista() from public;
revoke all on function public.exigir_email_en_lista() from anon;
revoke all on function public.exigir_email_en_lista() from authenticated;

drop trigger if exists exigir_email_en_lista on auth.users;
create trigger exigir_email_en_lista
  before insert on auth.users
  for each row execute function public.exigir_email_en_lista();
