-- Un Momento Rolled · etapa 1: tablas y permisos (RLS)
-- Una sola tabla "docs" guarda todas las colecciones de la app (products, sales, days…).
-- Los códigos (PIN del administrador y códigos de cajera) viven en tablas aparte que nadie puede leer directamente.

create extension if not exists pgcrypto with schema extensions;

create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','cajero')),
  name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create table public.docs (
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  ts bigint generated always as (
    case when jsonb_typeof(data->'ts') = 'number' then floor((data->>'ts')::numeric)::bigint end
  ) stored,
  day text generated always as (data->>'day') stored,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
create index docs_col_ts on public.docs (col, ts desc);
create index docs_col_day on public.docs (col, day desc);
alter table public.docs enable row level security;

create table public.admin_pin (
  id int primary key default 1 check (id = 1),
  hash text not null,
  updated_at timestamptz not null default now()
);
create table public.cashier_codes (
  name text primary key,
  hash text not null,
  updated_at timestamptz not null default now()
);
create table public.auth_attempts (
  id bigserial primary key,
  uid uuid not null,
  kind text not null,
  at timestamptz not null default now()
);
alter table public.admin_pin enable row level security;
alter table public.cashier_codes enable row level security;
alter table public.auth_attempts enable row level security;
-- Sin políticas: solo las funciones (security definer) pueden tocarlas.

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()))
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'admin')
$$;
revoke execute on function public.is_staff(), public.is_admin() from public, anon;
grant execute on function public.is_staff(), public.is_admin() to authenticated;

-- staff: cada quien ve su fila; el administrador ve y maneja todas.
create policy staff_select on public.staff for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy staff_admin_write on public.staff for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- docs
create policy docs_select on public.docs for select to authenticated
  using (public.is_staff());
create policy docs_insert on public.docs for insert to authenticated
  with check (public.is_staff() and (col in ('stock','sales','voids','days','cashouts','cashins','purchases','waste') or public.is_admin()));
-- Las ventas nunca se modifican ni se borran (se anulan con un registro en "voids").
create policy docs_update on public.docs for update to authenticated
  using (public.is_staff() and col <> 'sales' and (col in ('stock','days','flavors') or public.is_admin()))
  with check (public.is_staff() and col <> 'sales' and (col in ('stock','days','flavors') or public.is_admin()));
create policy docs_delete on public.docs for delete to authenticated
  using (public.is_admin() and col <> 'sales');

-- Tiempo real
alter publication supabase_realtime add table public.docs;
