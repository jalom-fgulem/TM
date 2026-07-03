-- Divide el blob único de "board" en una tabla por entidad, para que cada
-- guardado toque solo el registro que cambió en vez de reescribir todo el
-- tablero. "board" se conserva y pasa a contener solo {areas, tipos}.

create table if not exists public.tasks (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.meetings (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;
alter table public.projects enable row level security;
alter table public.meetings enable row level security;
alter table public.contacts enable row level security;
alter table public.notes enable row level security;

grant select, insert, update, delete on public.tasks to anon;
grant select, insert, update, delete on public.projects to anon;
grant select, insert, update, delete on public.meetings to anon;
grant select, insert, update, delete on public.contacts to anon;
grant select, insert, update, delete on public.notes to anon;

create policy "allow anon all" on public.tasks for all to anon using (true) with check (true);
create policy "allow anon all" on public.projects for all to anon using (true) with check (true);
create policy "allow anon all" on public.meetings for all to anon using (true) with check (true);
create policy "allow anon all" on public.contacts for all to anon using (true) with check (true);
create policy "allow anon all" on public.notes for all to anon using (true) with check (true);
