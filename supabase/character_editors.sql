create table public.character_editors (
 user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.character_editors enable row level security;
revoke all on public.character_editors from public,anon,authenticated;
grant select on public.character_editors to authenticated;
create policy "Read own character editor membership" on public.character_editors
 for select to authenticated using (user_id=(select auth.uid()));

create function public.save_characters(expected_revision integer, characters jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare current_play public.play%rowtype;
begin
 if not exists(select 1 from public.character_editors where user_id=auth.uid()) then
  raise exception 'Character editor required' using errcode='42501';
 end if;
 select * into strict current_play from public.play where id=1 for update;
 if current_play.revision<>expected_revision or expected_revision is null then
  raise sqlstate 'PT409' using message='Revision changed';
 end if;
 if jsonb_typeof(characters) is distinct from 'array' or jsonb_array_length(characters)<>jsonb_array_length(current_play.data->'characters') then
  raise exception 'Invalid character list';
 end if;
 if exists(select 1 from jsonb_array_elements(characters) with ordinality n(c,i)
  where (n.c - array['name','actor','bio','photo','color','notes']) is distinct from
        ((current_play.data->'characters'->((n.i-1)::integer)) - array['name','actor','bio','photo','color','notes'])
  or jsonb_typeof(n.c->'name') is distinct from 'string'
  or jsonb_typeof(n.c->'notes') is distinct from 'object'
  or exists(select 1 from jsonb_each(n.c) f where f.key in ('actor','bio','photo','color') and jsonb_typeof(f.value)<>'string')
  or exists(select 1 from jsonb_each(n.c->'notes') f where jsonb_typeof(f.value)<>'string')
 ) then raise exception 'Invalid character profile'; end if;
 current_play.data=jsonb_set(current_play.data,'{characters}',characters);
 if octet_length(current_play.data::text)>2000000 then raise exception 'Play too large'; end if;
 update public.play set data=current_play.data,revision=revision+1,updated_at=now() where id=1 returning revision into expected_revision;
 return expected_revision;
end;
$$;
revoke all on function public.save_characters(integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_characters(integer,jsonb) to authenticated;
create policy "Character editors upload profile photos" on storage.objects for insert to authenticated with check (
 bucket_id='character-photos' and name ~ '^c([1-9]|[12][0-9]|3[0-6])/[0-9a-f-]+\.(jpg|png|webp|gif)$'
 and exists(select 1 from public.character_editors where user_id=(select auth.uid()))
);
