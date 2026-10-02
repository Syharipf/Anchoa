create extension if not exists pg_cron;

create table public.vault (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  kdf jsonb not null,
  dek_by_passphrase bytea not null,
  dek_by_recovery bytea not null,
  created_at timestamptz not null default now()
);

create sequence public.records_seq as bigint;

create table public.records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null constraint records_id_length check (length(id) <= 80),
  changed_at bigint not null,
  device_id uuid not null,
  deleted boolean not null default false,
  -- Tombstones also carry an encrypted document; NULL is never a valid payload.
  payload bytea not null constraint records_payload_size check (octet_length(payload) <= 262144),
  seq bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index records_user_seq on public.records (user_id, seq);

create function public.stamp_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Never retain a client-supplied seq, including on an accepted UPDATE.
  new.seq := pg_catalog.nextval('public.records_seq'::pg_catalog.regclass);
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger records_stamp
before insert or update on public.records
for each row execute function public.stamp_record();

alter table public.vault enable row level security;
alter table public.vault force row level security;
alter table public.records enable row level security;
alter table public.records force row level security;

create policy vault_select on public.vault
for select to authenticated using (user_id = (select auth.uid()));
create policy vault_insert on public.vault
for insert to authenticated with check (user_id = (select auth.uid()));
create policy vault_update on public.vault
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy records_select on public.records
for select to authenticated using (user_id = (select auth.uid()));
create policy records_insert on public.records
for insert to authenticated with check (user_id = (select auth.uid()));
create policy records_update on public.records
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create function public.push_records(rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  incoming record;
  rejected jsonb := '[]'::jsonb;
  stored_version jsonb;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if pg_catalog.jsonb_typeof(rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'rows must be a JSON array';
  end if;
  if pg_catalog.jsonb_array_length(rows) > 500 then
    raise exception using errcode = '22023', message = 'push_records accepts at most 500 rows';
  end if;

  for incoming in
    select * from pg_catalog.jsonb_to_recordset(rows) as r(
      id text, changed_at bigint, device_id uuid, deleted boolean, payload text
    )
  loop
    if incoming.payload is not null and pg_catalog.left(incoming.payload, 2) <> '\x' then
      raise exception using errcode = '22023', message = 'payload must be a hex bytea string';
    end if;

    -- The caller comes only from the JWT. Any input user_id is ignored.
    insert into public.records as stored (user_id, id, changed_at, device_id, deleted, payload)
    values (caller, incoming.id, incoming.changed_at, incoming.device_id,
            incoming.deleted, incoming.payload::pg_catalog.bytea)
    on conflict (user_id, id) do update
      set changed_at = excluded.changed_at,
          device_id = excluded.device_id,
          deleted = excluded.deleted,
          payload = excluded.payload
      where (excluded.changed_at, excluded.device_id) > (stored.changed_at, stored.device_id);

    if not found then
      select pg_catalog.jsonb_build_object(
        'id', r.id, 'changed_at', r.changed_at, 'device_id', r.device_id
      ) into stored_version
      from public.records as r where r.user_id = caller and r.id = incoming.id;
      rejected := rejected || pg_catalog.jsonb_build_array(stored_version);
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('rejected', rejected);
end;
$$;

create function public.pull_records(after bigint, max integer)
returns setof public.records
language sql
stable
security invoker
set search_path = ''
as $$
  select r.* from public.records as r
  where r.user_id = (select auth.uid()) and r.seq > $1
  order by r.seq
  limit greatest(1, least(coalesce($2, 500), 500));
$$;

create function public.usage()
returns table(rows bigint, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.count(*), coalesce(pg_catalog.sum(pg_catalog.octet_length(r.payload)), 0::bigint)
  from public.records as r where r.user_id = (select auth.uid());
$$;

-- An invoker cannot DELETE with no DELETE policy. Keep all four public RPCs
-- invokers and isolate that privilege in a private, argument-free helper.
-- This schema is not exposed by PostgREST. Its owner must bypass forced RLS;
-- the JWT-derived predicate limits both deletions to the caller's own data.
create schema anchoa_private;
revoke all on schema anchoa_private from public, anon, authenticated;
grant usage on schema anchoa_private to authenticated;

create function anchoa_private.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  delete from public.records where user_id = caller;
  delete from public.vault where user_id = caller;
end;
$$;
alter function anchoa_private.delete_my_data() owner to postgres;

create function public.delete_my_data()
returns void
language sql
security invoker
set search_path = ''
as $$
  select anchoa_private.delete_my_data();
$$;

revoke all on table public.vault, public.records from public, anon, authenticated;
revoke all on sequence public.records_seq from public, anon, authenticated;
revoke all on function public.stamp_record(), public.push_records(jsonb),
  public.pull_records(bigint, integer), public.usage(), public.delete_my_data(),
  anchoa_private.delete_my_data() from public, anon, authenticated;

grant select, insert, update on table public.vault to authenticated;
-- Choose the invoker + RLS option: push_records needs INSERT/UPDATE and sequence
-- USAGE as the caller. Direct owner writes are consequently allowed, but RLS
-- forbids cross-user reads/writes and there is no DELETE grant or policy.
grant select, insert, update on table public.records to authenticated;
grant usage on sequence public.records_seq to authenticated;
grant execute on function public.push_records(jsonb), public.pull_records(bigint, integer),
  public.usage(), public.delete_my_data(), anchoa_private.delete_my_data() to authenticated;

-- Explicitly run as postgres so cleanup bypasses forced RLS for every user.
select cron.schedule_in_database(
  'anchoa-prune-tombstones',
  '0 3 * * *',
  $job$delete from public.records where deleted and updated_at < now() - interval '90 days'$job$,
  pg_catalog.current_database(),
  'postgres'
);
