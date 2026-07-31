-- Aislamiento por usuario en las tablas de negocio.
--
-- Hasta ahora la política era "for all to authenticated using (true)": RLS
-- estaba encendido pero no separaba nada, así que cualquier cuenta con sesión
-- veía y podía borrar los datos de todas. Aquí se cierra.
--
-- Lo que NO se toca, a propósito:
--   * La clave primaria sigue siendo "id text". El cliente hace upsert por id
--     y no envía user_id; una clave compuesta rompería los guardados en
--     silencio. La clave compuesta se pospone a la fase multiusuario real.
--   * Ni una línea de JavaScript. user_id se rellena solo, por DEFAULT
--     auth.uid(), así que las escrituras actuales del front siguen valiendo.
--
-- Consecuencia conocida de mantener la clave primaria simple: un segundo
-- usuario no podría crear su propia fila de "board", porque su id es la misma
-- constante literal para todos ('tablero-fgulem-datos') y chocaría con la del
-- propietario. Hoy no importa (un solo usuario) y se resuelve en la fase
-- multiusuario junto con la clave compuesta.

-- ------------------------------------------------------- 1) columna y relleno
do $$
declare
  tablas      text[] := array['tasks','projects','meetings','contacts','notes','board'];
  t           text;
  pendientes  bigint := 0;
  cuentas     bigint;
  propietario uuid;
  n           bigint;
begin
  -- La columna primero sin NOT NULL: hay que poder rellenarla.
  foreach t in array tablas loop
    execute format('alter table public.%I add column if not exists user_id uuid', t);
  end loop;

  -- ¿Queda algo por asignar? Si la migración ya se aplicó, esto es 0 y el
  -- bloque de reparto se salta entero (así puede reejecutarse sin daño).
  foreach t in array tablas loop
    execute format('select count(*) from public.%I where user_id is null', t) into n;
    pendientes := pendientes + n;
  end loop;

  if pendientes > 0 then
    select count(*) into cuentas from auth.users;

    -- Con más de una cuenta, repartir a ojo sería inventarse a quién pertenece
    -- cada fila. Se aborta y se decide a mano.
    if cuentas <> 1 then
      raise exception
        'Aborto: % filas sin user_id y % cuentas en auth.users. El reparto no es automático.',
        pendientes, cuentas;
    end if;

    -- El id se consulta, no se escribe literal en la migración.
    select id into propietario from auth.users;

    foreach t in array tablas loop
      execute format('update public.%I set user_id = %L where user_id is null', t, propietario);
    end loop;

    raise notice 'Asignadas % filas al único usuario existente.', pendientes;
  end if;
end $$;

-- --------------------------------------- 2) valor por defecto, NOT NULL, clave
-- ajena, índice y políticas
do $$
declare
  tablas text[] := array['tasks','projects','meetings','contacts','notes','board'];
  t      text;
begin
  foreach t in array tablas loop
    -- Lo que hace que el front siga funcionando sin tocarlo: si la escritura
    -- no trae user_id, se pone el del que ha iniciado sesión.
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
    execute format('alter table public.%I alter column user_id set not null', t);

    -- Clave ajena (no existe "add constraint if not exists").
    if not exists (
      select 1 from pg_constraint
       where conrelid = format('public.%I', t)::regclass
         and conname  = t || '_user_id_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (user_id)
           references auth.users(id) on delete cascade',
        t, t || '_user_id_fkey');
    end if;

    execute format('create index if not exists %I on public.%I(user_id)',
                   t || '_user_id_idx', t);

    -- RLS: idempotente, y así queda comprobado que sigue encendido.
    execute format('alter table public.%I enable row level security', t);

    -- Fuera la política que no separaba nada.
    execute format('drop policy if exists "solo usuarios identificados" on public.%I', t);

    -- Una política por operación, con auth.uid() en using y en with check.
    execute format('drop policy if exists "propio: ver" on public.%I', t);
    execute format($f$create policy "propio: ver" on public.%I
                     for select to authenticated
                     using (auth.uid() = user_id)$f$, t);

    execute format('drop policy if exists "propio: crear" on public.%I', t);
    execute format($f$create policy "propio: crear" on public.%I
                     for insert to authenticated
                     with check (auth.uid() = user_id)$f$, t);

    execute format('drop policy if exists "propio: modificar" on public.%I', t);
    execute format($f$create policy "propio: modificar" on public.%I
                     for update to authenticated
                     using (auth.uid() = user_id)
                     with check (auth.uid() = user_id)$f$, t);

    execute format('drop policy if exists "propio: borrar" on public.%I', t);
    execute format($f$create policy "propio: borrar" on public.%I
                     for delete to authenticated
                     using (auth.uid() = user_id)$f$, t);
  end loop;
end $$;

-- PostgREST guarda en memoria la forma de las tablas; se le avisa del cambio.
notify pgrst, 'reload schema';
