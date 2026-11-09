-- Apply after setup.sql when configuring a new project.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('character-photos','character-photos',true,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;
create policy "Sole editor uploads character photos" on storage.objects
for insert to authenticated with check (
  bucket_id = 'character-photos'
  and name ~ '^c([1-9]|[12][0-9]|3[0-6])/[0-9a-f-]+\.(jpg|png|webp|gif)$'
  and exists (select 1 from public.editors where user_id = (select auth.uid()))
);
