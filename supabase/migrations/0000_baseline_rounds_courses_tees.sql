-- supabase/migrations/0000_baseline_rounds_courses_tees.sql
--
-- DOCUMENTATION ONLY — DO NOT RUN THIS AGAINST THE EXISTING LIVE PROJECT.
-- The tables below already exist in the live Supabase project referenced by
-- this app (cfuxiifpvuzvysjxztax); they predate this repo's migration
-- history and no earlier migration file ever created them. This file is a
-- best-effort reconstruction (via live `information_schema`/`pg_policies`
-- introspection on 2026-07-02, not a `pg_dump`) so that migrations
-- 0000 -> 0002 can bootstrap an equivalent schema from an EMPTY project
-- (e.g. a fresh staging environment or a disaster-recovery rebuild).
-- Running it against the current live project will fail with
-- "relation already exists" errors, same as 0002 did on first attempt.
--
-- courses/tees are included only as minimal shells sufficient to satisfy
-- rounds.course_id/tee_id's foreign keys — this app never reads or writes
-- them (course/hole data is sourced live from OpenStreetMap). Their own RLS
-- policies, if any exist live, were not captured, since this app doesn't
-- use them; add real ones before relying on this table for anything else.

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  state text,
  country text,
  holes integer,
  par integer,
  verified boolean,
  created_by uuid,
  created_at timestamptz default now()
);

create table public.tees (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  name text not null,
  color text,
  total_yardage integer,
  course_rating numeric not null,
  slope_rating integer not null,
  par integer
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  course_id uuid not null references public.courses(id),
  tee_id uuid not null references public.tees(id),
  played_at date not null,
  status text,
  gross_score integer,
  adjusted_score integer,
  differential numeric,
  weather text,
  notes text,
  created_at timestamptz default now(),
  hole_count integer not null
);

create table public.round_holes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id),
  hole_number integer not null,
  gross_score integer not null,
  putts integer,
  fairway_hit boolean,
  gir boolean,
  fairway_direction text,
  gir_direction text,
  scramble boolean
);

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id),
  hole_number integer not null,
  shot_number integer not null,
  club text,
  distance_yds integer,
  lie text,
  result text,
  lat double precision,
  lng double precision,
  created_at timestamptz default now()
);

alter table public.rounds enable row level security;
alter table public.round_holes enable row level security;
alter table public.shots enable row level security;

create policy "users read own rounds"
  on public.rounds for select using (auth.uid() = user_id);
create policy "users insert own rounds"
  on public.rounds for insert with check (auth.uid() = user_id);
create policy "users update own rounds"
  on public.rounds for update using (auth.uid() = user_id);
create policy "users delete own rounds"
  on public.rounds for delete using (auth.uid() = user_id);

create policy "users read own round holes"
  on public.round_holes for select
  using (exists (select 1 from public.rounds r where r.id = round_holes.round_id and r.user_id = auth.uid()));
create policy "users insert own round holes"
  on public.round_holes for insert
  with check (exists (select 1 from public.rounds r where r.id = round_holes.round_id and r.user_id = auth.uid()));

create policy "users read own shots"
  on public.shots for select
  using (exists (select 1 from public.rounds r where r.id = shots.round_id and r.user_id = auth.uid()));
create policy "users insert own shots"
  on public.shots for insert
  with check (exists (select 1 from public.rounds r where r.id = shots.round_id and r.user_id = auth.uid()));
