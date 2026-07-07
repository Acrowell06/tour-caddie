-- supabase/migrations/0008_add_profiles_insert_policy.sql
--
-- profiles has had SELECT ("users read own profile") and UPDATE ("users
-- update own profile") policies since before this repo's migration history,
-- but no INSERT policy. Not a live bug today — the only insert path is the
-- SECURITY DEFINER signup trigger (public.handle_new_user), which bypasses
-- RLS by design, and every client-side profiles write since has been an
-- upsert against a row that trigger already created. Adding this policy now
-- closes the gap before any future flow needs to insert a profiles row
-- client-side.

create policy "users insert own profile"
  on public.profiles for insert
  to public
  with check (auth.uid() = id);
