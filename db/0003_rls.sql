-- profiles: everyone with a profile can see the team; you edit only your own
-- name; only an admin changes roles (via the admin update policy below).
create policy profiles_select on ehs.profiles
  for select to authenticated
  using (ehs.caller_role() is not null);

create policy profiles_insert_self on ehs.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self on ehs.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = ehs.caller_role());

create policy profiles_admin_all on ehs.profiles
  for all to authenticated
  using (ehs.caller_role() = 'admin')
  with check (ehs.caller_role() = 'admin');

-- access_codes and code_attempts: no client access at all. The SECURITY
-- DEFINER functions bypass RLS; nothing else may touch these.
-- (RLS enabled with no policies = deny all.)

-- machines: everyone reads the catalog, only admins change it.
create policy machines_select on ehs.machines
  for select to authenticated
  using (ehs.caller_role() is not null);

create policy machines_admin_write on ehs.machines
  for all to authenticated
  using (ehs.caller_role() = 'admin')
  with check (ehs.caller_role() = 'admin');

-- machine_states: everyone reads, inspectors and admins write.
create policy states_select on ehs.machine_states
  for select to authenticated
  using (ehs.caller_role() is not null);

create policy states_write on ehs.machine_states
  for all to authenticated
  using (ehs.caller_role() in ('inspector','admin'))
  with check (ehs.caller_role() in ('inspector','admin'));

-- photos: everyone reads, inspectors add, authors and admins delete.
create policy photos_select on ehs.photos
  for select to authenticated
  using (ehs.caller_role() is not null);

create policy photos_insert on ehs.photos
  for insert to authenticated
  with check (ehs.caller_role() in ('inspector','admin') and taken_by = auth.uid());

create policy photos_delete on ehs.photos
  for delete to authenticated
  using (taken_by = auth.uid() or ehs.caller_role() = 'admin');

-- comments: anyone with a profile posts; authors edit their own for 5 minutes;
-- authors and admins delete.
create policy comments_select on ehs.comments
  for select to authenticated
  using (ehs.caller_role() is not null);

create policy comments_insert on ehs.comments
  for insert to authenticated
  with check (ehs.caller_role() is not null and author_id = auth.uid());

create policy comments_update_own on ehs.comments
  for update to authenticated
  using (author_id = auth.uid() and created_at > now() - interval '5 minutes')
  with check (author_id = auth.uid());

create policy comments_delete on ehs.comments
  for delete to authenticated
  using (author_id = auth.uid() or ehs.caller_role() = 'admin');

-- comment_reads: strictly your own.
create policy reads_own on ehs.comment_reads
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Realtime broadcast for the two tables clients subscribe to.
alter publication supabase_realtime add table ehs.machine_states;
alter publication supabase_realtime add table ehs.comments;

-- Private photo bucket.
insert into storage.buckets (id, name, public)
  values ('inspection-photos', 'inspection-photos', false)
on conflict (id) do nothing;

create policy photos_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-photos' and ehs.caller_role() is not null);

create policy photos_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'inspection-photos' and ehs.caller_role() in ('inspector','admin'));

create policy photos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'inspection-photos'
         and (owner = auth.uid() or ehs.caller_role() = 'admin'));
