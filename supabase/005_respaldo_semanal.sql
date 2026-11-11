-- Copia interna semanal: cada lunes de madrugada el servidor guarda una foto completa de los datos.
-- Protege de borrados o cambios por error. NO sustituye el archivo de respaldo descargado
-- (si se perdiera el proyecto de Supabase, estas copias se irían con él).
create extension if not exists pg_cron;

create table if not exists public.docs_snapshots (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  n integer not null,
  docs jsonb not null
);
alter table public.docs_snapshots enable row level security;   -- sin políticas: nadie la lee desde la app
revoke all on public.docs_snapshots from anon, authenticated;

create or replace function public.snapshot_docs() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.docs_snapshots (n, docs)
  select count(*), coalesce(jsonb_agg(jsonb_build_object('col', d.col, 'id', d.id, 'data', d.data, 'ts', d.ts, 'day', d.day)), '[]'::jsonb)
  from public.docs d;
  delete from public.docs_snapshots s
  where s.id not in (select id from public.docs_snapshots order by taken_at desc limit 3);   -- se conservan las 3 últimas
end $$;
revoke all on function public.snapshot_docs() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'respaldo-semanal';
select cron.schedule('respaldo-semanal', '0 8 * * 1', 'select public.snapshot_docs()');   -- lunes 08:00 UTC = 4:00 a. m. en RD
