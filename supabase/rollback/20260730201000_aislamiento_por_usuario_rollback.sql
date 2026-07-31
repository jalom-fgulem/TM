-- Deshace 20260730201000_aislamiento_por_usuario.sql
--
-- Devuelve las seis tablas al estado anterior: sin user_id y con la política
-- única "solo usuarios identificados" que dejaba pasar todo a cualquier
-- cuenta con sesión. Solo tiene sentido si algo se rompe y hay que volver
-- atrás mientras se diagnostica.
--
-- No hay pérdida de datos: se elimina la columna user_id (que hoy vale lo
-- mismo en todas las filas: el único usuario), nunca las filas.

do $$
declare
  tablas text[] := array['tasks','projects','meetings','contacts','notes','board'];
  t      text;
begin
  foreach t in array tablas loop
    execute format('drop policy if exists "propio: ver"        on public.%I', t);
    execute format('drop policy if exists "propio: crear"      on public.%I', t);
    execute format('drop policy if exists "propio: modificar"  on public.%I', t);
    execute format('drop policy if exists "propio: borrar"     on public.%I', t);

    execute format('drop index if exists public.%I', t || '_user_id_idx');
    execute format('alter table public.%I drop column if exists user_id', t);

    execute format('drop policy if exists "solo usuarios identificados" on public.%I', t);
    execute format($f$create policy "solo usuarios identificados" on public.%I
                     for all to authenticated using (true) with check (true)$f$, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
