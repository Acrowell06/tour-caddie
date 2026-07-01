-- supabase/migrations/0001_create_profiles.sql
--
-- The `profiles` table, RLS, and "read/update own profile" policies already
-- existed in this Supabase project (created in an earlier session, with
-- golf-specific columns: display_name, avatar_url, home_club,
-- handicap_index). This migration only adds what was actually missing:
-- the `email` column, and the trigger that auto-creates a profile row
-- whenever someone signs up. Written to be safe to re-run.

alter table public.profiles add column if not exists email text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
