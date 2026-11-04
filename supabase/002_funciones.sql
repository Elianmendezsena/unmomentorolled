-- Caja Heladería · etapa 1: funciones (códigos en el servidor)

-- Mezcla campos en un documento sin pisar el resto (equivale a "update" de la app).
create or replace function public.doc_merge(p_col text, p_id text, p_patch jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.docs set data = data || p_patch, updated_at = now() where col = p_col and id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Freno contra adivinar códigos: 5 fallos en un minuto bloquean ese tipo de intento.
create or replace function public._guard(p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from public.auth_attempts
   where uid = (select auth.uid()) and kind = p_kind and at > now() - interval '60 seconds';
  if n >= 5 then raise exception 'locked' using errcode = 'P0001'; end if;
end $$;

create or replace function public.whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) - 'user_id' - 'created_at' from public.staff s where s.user_id = (select auth.uid())
$$;

create or replace function public.pin_status() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return exists (select 1 from public.admin_pin);
end $$;

create or replace function public.check_admin_pin(p_pin text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public._guard('pin');
  select hash into h from public.admin_pin where id = 1;
  if h is null or extensions.crypt(coalesce(p_pin, ''), h) <> h then
    insert into public.auth_attempts(uid, kind) values ((select auth.uid()), 'pin');
    return false;
  end if;
  delete from public.auth_attempts where uid = (select auth.uid()) and kind = 'pin';
  return true;
end $$;

create or replace function public.set_admin_pin(p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_pin !~ '^\d{4,8}$' then raise exception 'invalid_pin' using errcode = 'P0001'; end if;
  insert into public.admin_pin(id, hash) values (1, extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (id) do update set hash = excluded.hash, updated_at = now();
end $$;

create or replace function public.code_names() returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select array_agg(name order by name) from public.cashier_codes), '{}');
end $$;

create or replace function public.verify_cashier_code(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare r record; who text;
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public._guard('code');
  for r in select name, hash from public.cashier_codes loop
    if extensions.crypt(coalesce(p_code, ''), r.hash) = r.hash then who := r.name; exit; end if;
  end loop;
  if who is null then
    insert into public.auth_attempts(uid, kind) values ((select auth.uid()), 'code');
    return null;
  end if;
  delete from public.auth_attempts where uid = (select auth.uid()) and kind = 'code';
  return who;
end $$;

create or replace function public.set_cashier_code(p_name text, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_code !~ '^\d{4,6}$' then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  for r in select name, hash from public.cashier_codes where name <> p_name loop
    if extensions.crypt(p_code, r.hash) = r.hash then raise exception 'duplicate' using errcode = 'P0001'; end if;
  end loop;
  insert into public.cashier_codes(name, hash) values (p_name, extensions.crypt(p_code, extensions.gen_salt('bf')))
  on conflict (name) do update set hash = excluded.hash, updated_at = now();
end $$;

create or replace function public.delete_cashier_code(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.cashier_codes where name = p_name;
end $$;

-- Solo usuarios con sesión pueden llamar estas funciones.
do $$
declare f text;
begin
  foreach f in array array[
    'doc_merge(text,text,jsonb)','_guard(text)','whoami()','pin_status()','check_admin_pin(text)','set_admin_pin(text)',
    'code_names()','verify_cashier_code(text)','set_cashier_code(text,text)','delete_cashier_code(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public._guard(text) from authenticated;
end $$;
