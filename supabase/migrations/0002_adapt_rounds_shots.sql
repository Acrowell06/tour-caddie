-- supabase/migrations/0002_adapt_rounds_shots.sql

-- rounds: course_id/tee_id are NOT NULL foreign keys into courses/tees
-- tables this app never writes to (course/hole data is sourced live from
-- OpenStreetMap via tc-course.js, never persisted to Supabase). Make them
-- optional and add the plain-text fields the app actually has.
alter table public.rounds alter column course_id drop not null;
alter table public.rounds alter column tee_id drop not null;
alter table public.rounds add column course_name text;
alter table public.rounds add column tee_name text;
alter table public.rounds add column tee_yardage int;
alter table public.rounds alter column status set default 'in_progress';
alter table public.rounds alter column played_at set default current_date;

-- round_holes: add the two columns this app needs that don't exist yet,
-- and a uniqueness constraint so hole-end syncs can safely upsert on retry.
alter table public.round_holes add column par int;
alter table public.round_holes add column handicap int;
alter table public.round_holes add constraint round_holes_round_hole_unique unique (round_id, hole_number);

-- Existing RLS only covers select/insert on round_holes and shots — add
-- what's missing, matching the existing join-through-rounds policy style.
create policy "users update own round holes"
  on public.round_holes for update
  using (exists (select 1 from public.rounds r where r.id = round_holes.round_id and r.user_id = auth.uid()));

create policy "users delete own shots"
  on public.shots for delete
  using (exists (select 1 from public.rounds r where r.id = shots.round_id and r.user_id = auth.uid()));
