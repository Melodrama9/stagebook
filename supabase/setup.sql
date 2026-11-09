-- Run in the Supabase SQL editor. Safe to run again; existing play content is preserved.
create table if not exists public.editors (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
create table if not exists public.play (
  id integer primary key check (id = 1),
  data jsonb not null,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.editors enable row level security;
alter table public.play enable row level security;
revoke all on public.editors from anon, authenticated;
revoke all on public.play from anon, authenticated;
grant select on public.play to anon, authenticated;
grant select on public.editors to authenticated;
drop policy if exists "Public can read the play" on public.play;
create policy "Public can read the play" on public.play for select to anon, authenticated using (true);
drop policy if exists "Editor can see own membership" on public.editors;
create policy "Editor can see own membership" on public.editors for select to authenticated using (user_id = (select auth.uid()));
-- No client can appoint an editor. The singleton primary key permits exactly one membership.
create or replace function public.save_play(expected_revision integer, new_data jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare next_revision integer;
begin
  if not exists (select 1 from public.editors where user_id = auth.uid()) then
    raise exception 'Editor access required' using errcode = '42501';
  end if;
  if jsonb_typeof(new_data->'points') is distinct from 'array'
    or jsonb_typeof(new_data->'characters') is distinct from 'array'
    or jsonb_typeof(new_data->'props') is distinct from 'array' then
    raise exception 'Invalid play structure' using errcode = '22023';
  end if;
  if jsonb_array_length(new_data->'characters') <> 36 or octet_length(new_data::text) > 2000000 then
    raise exception 'Expected 36 characters and a play under 2 MB' using errcode = '22023';
  end if;
  update public.play set data = new_data, revision = revision + 1, updated_at = now()
    where id = 1 and revision = expected_revision returning revision into next_revision;
  if next_revision is null then
    raise sqlstate 'PT409' using message = 'The play changed. Reload before editing.';
  end if;
  return next_revision;
end;
$$;
revoke all on function public.save_play(integer,jsonb) from public, anon;
grant execute on function public.save_play(integer,jsonb) to authenticated;
insert into public.play (id,data)
select 1,jsonb_build_object(
  'points','[]'::jsonb,
  'characters',(select jsonb_agg(jsonb_build_object('id','c'||n,'name','Персонаж '||lpad(n::text,2,'0'),'actor','','bio','','photo','','notes','{}'::jsonb) order by n) from generate_series(1,36) n),
  'props','[]'::jsonb
) on conflict (id) do nothing;
-- After creating your editor in Authentication > Users, run separately:
-- insert into public.editors(singleton,user_id) values (true, 'YOUR-EDITOR-USER-UUID');
