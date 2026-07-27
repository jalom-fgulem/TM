-- Paso intermedio de la migración a login obligatorio.
--
-- Hasta ahora las tablas solo admitían el rol 'anon' (cualquiera con la clave
-- pública). Al iniciar sesión, las peticiones pasan a ir como 'authenticated',
-- que NO encajaba en ninguna política: la app se quedaría sin datos.
--
-- Aquí se admiten los dos roles a la vez, para que la aplicación siga
-- funcionando durante la transición. Una migración posterior retirará 'anon'
-- una vez comprobado que el login funciona.

grant select, insert, update, delete on public.board to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.meetings to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.notes to authenticated;

alter policy "allow anon all" on public.board        to anon, authenticated;
alter policy "allow anon all" on public.tasks        to anon, authenticated;
alter policy "allow anon all" on public.projects     to anon, authenticated;
alter policy "allow anon all" on public.meetings     to anon, authenticated;
alter policy "allow anon all" on public.contacts     to anon, authenticated;
alter policy "allow anon all" on public.notes        to anon, authenticated;
