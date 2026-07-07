-- supabase/migrations/0007_add_course_data.sql

-- Shared, crowd-sourced course data: Course Rating/Slope per tee, and
-- per-hole Par/Handicap/Yardage per tee — populated by manual entry or a
-- scorecard photo scan. Keyed by the same geoKey (TcCourse.geoKeyFor)
-- already used as the de facto course-identity key everywhere else in
-- this app. Conflict model is whole-row last-write-wins with an audit
-- trail (source/updated_by/updated_at) — every write must read-merge-write
-- rather than blind-overwrite, enforced in pages/tc-course-data.js, not here.
create table public.course_data (
  geo_key       text primary key,
  course_name   text,
  rating_slope  jsonb not null default '{}'::jsonb,
  holes         jsonb not null default '[]'::jsonb,
  source        text not null default 'manual' check (source in ('manual','scan')),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

alter table public.course_data enable row level security;

create policy "authenticated users read course_data"
  on public.course_data for select
  to authenticated
  using (true);

create policy "authenticated users insert course_data"
  on public.course_data for insert
  to authenticated
  with check (true);

create policy "authenticated users update course_data"
  on public.course_data for update
  to authenticated
  using (true);
