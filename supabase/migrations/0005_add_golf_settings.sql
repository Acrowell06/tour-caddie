-- supabase/migrations/0005_add_golf_settings.sql

-- profiles.home_club already exists (text, currently unused by any client
-- code) — reused here for the golfer's Home Course name. These four new
-- columns give it real coordinates (needed to re-look-up tee/hole data via
-- TcCourse.loadNear, exactly like rounds.html's sel.course object already
-- carries {name, lat, lng}) and add the other two Golf settings that
-- previously only lived in profile.html's in-memory state.
alter table public.profiles add column if not exists home_club_lat double precision;
alter table public.profiles add column if not exists home_club_lng double precision;
alter table public.profiles add column if not exists default_tee_key text;
alter table public.profiles add column if not exists distance_unit text default 'yards';
