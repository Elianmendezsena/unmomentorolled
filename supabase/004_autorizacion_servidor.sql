-- Un Momento Rolled · etapa 2: descuentos y anulaciones autorizados en el SERVIDOR.
-- Antes el código del administrador solo se pedía en pantalla. Ahora quien no es administrador
-- necesita una "autorización" de un solo uso (ficha) que solo se obtiene con el código correcto.

create table if not exists public.auth_tokens (
  token uuid primary key default gen_random_uuid(),
  kind text not null,
  uid uuid not null,
  created_at timestamptz not null default now()
);
alter table public.auth_tokens enable row level security;     -- sin políticas: solo las funciones la tocan
revoke all on public.auth_tokens from anon, authenticated;

create or replace function public.grant_auth(p_pin text, p_kind text) returns text
language plpgsql security definer set search_path = '' as $$
declare h text; t uuid;
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind not in ('discount','void') then raise exception 'invalid_kind' using errcode = 'P0001'; end if;
  perform public._guard('pin');
  select hash into h from public.admin_pin where id = 1;
  if h is null or extensions.crypt(coalesce(p_pin, ''), h) <> h then
    insert into public.auth_attempts(uid, kind) values ((select auth.uid()), 'pin');
    return null;
  end if;
  delete from public.auth_attempts where uid = (select auth.uid()) and kind = 'pin';
  delete from public.auth_tokens where created_at < now() - interval '2 days';
  insert into public.auth_tokens(kind, uid) values (p_kind, (select auth.uid())) returning token into t;
  return t::text;
end $$;
revoke execute on function public.grant_auth(text, text) from public, anon;
grant execute on function public.grant_auth(text, text) to authenticated;

-- Al guardar: una venta con descuento o una anulación exige su ficha (salvo cuenta administradora).
create or replace function public.docs_guard_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; tk text; need boolean := false; n int;
begin
  tk := new.data->>'authToken';
  new.data := new.data - 'authToken';
  if public.is_admin() then return new; end if;
  if new.col = 'sales' then
    need := coalesce((new.data->>'discount')::numeric, 0) > 0.001
         or coalesce((new.data->>'subtotal')::numeric, 0) - coalesce((new.data->>'total')::numeric, 0) > 0.011;
    k := 'discount';
  elsif new.col = 'voids' then
    need := true; k := 'void';
  end if;
  if not need then return new; end if;
  -- reintento de algo ya guardado: no vuelve a pedir ficha (el guardado no cambia nada)
  if exists (select 1 from public.docs d where d.col = new.col and d.id = new.id) then return new; end if;
  delete from public.auth_tokens
   where token::text = coalesce(tk, '') and kind = k and uid = (select auth.uid()) and created_at > now() - interval '12 hours';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'needs_authorization' using errcode = '42501'; end if;
  return new;
end $$;
revoke execute on function public.docs_guard_auth() from public, anon, authenticated;

drop trigger if exists docs_guard_auth on public.docs;
create trigger docs_guard_auth before insert on public.docs
  for each row execute function public.docs_guard_auth();
