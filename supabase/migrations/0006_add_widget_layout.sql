-- supabase/migrations/0006_add_widget_layout.sql

-- Stores home.html's widgetConfig array ({id, size, slots[]}[]) directly as
-- jsonb. Null means "never customized" — home.html falls back to its
-- hardcoded default layout in that case.
alter table public.profiles add column if not exists widget_layout jsonb;
