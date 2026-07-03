-- supabase/migrations/0003_add_rounds_completed_at.sql

-- rounds.played_at is a date (no time component), so nothing records when a
-- round actually finished, and same-day rounds have no reliable sort order.
-- Adds a real completion timestamp, set by the app when the last hole syncs.
alter table public.rounds add column completed_at timestamptz;
