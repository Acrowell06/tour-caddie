-- supabase/migrations/0004_add_strokes_gained_columns.sql

-- round_holes: persist tee AND green positions so distance-to-pin can be
-- computed after the fact from shot positions. Both endpoints of the hole
-- are needed — the tee position is where shot 1's "distance before" comes
-- from; the green position is what every shot's "distance to pin" is
-- measured against. Previously only used transiently client-side during
-- play (from OSM data), then discarded.
alter table public.round_holes add column tee_lat double precision;
alter table public.round_holes add column tee_lng double precision;
alter table public.round_holes add column green_lat double precision;
alter table public.round_holes add column green_lng double precision;

-- shots: per-shot Strokes Gained value (shots.lie already exists,
-- unpopulated by any code until this feature — no migration needed for it).
alter table public.shots add column sg_value numeric;

-- rounds: round-level SG rollup by category, mirroring how
-- rounds.differential already works.
alter table public.rounds add column sg_ott numeric;
alter table public.rounds add column sg_app numeric;
alter table public.rounds add column sg_atg numeric;
alter table public.rounds add column sg_putt numeric;
alter table public.rounds add column sg_total numeric;
