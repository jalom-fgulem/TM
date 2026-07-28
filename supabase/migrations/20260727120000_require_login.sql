-- Cierre definitivo: la aplicación pasa a exigir sesión iniciada.
--
-- Hasta ahora las tablas admitían el rol 'anon', lo que significaba que
-- cualquiera que conociera la dirección de la app podía leer y escribir el
-- tablero. Comprobado ya que el login funciona, se retira ese acceso.

alter policy "allow anon all" on public.board    to authenticated;
alter policy "allow anon all" on public.tasks    to authenticated;
alter policy "allow anon all" on public.projects to authenticated;
alter policy "allow anon all" on public.meetings to authenticated;
alter policy "allow anon all" on public.contacts to authenticated;
alter policy "allow anon all" on public.notes    to authenticated;

revoke all on public.board    from anon;
revoke all on public.tasks    from anon;
revoke all on public.projects from anon;
revoke all on public.meetings from anon;
revoke all on public.contacts from anon;
revoke all on public.notes    from anon;

-- El nombre de la política ya no describe lo que hace.
alter policy "allow anon all" on public.board    rename to "solo usuarios identificados";
alter policy "allow anon all" on public.tasks    rename to "solo usuarios identificados";
alter policy "allow anon all" on public.projects rename to "solo usuarios identificados";
alter policy "allow anon all" on public.meetings rename to "solo usuarios identificados";
alter policy "allow anon all" on public.contacts rename to "solo usuarios identificados";
alter policy "allow anon all" on public.notes    rename to "solo usuarios identificados";
