-- Run this file in the Supabase SQL Editor for the ORVEX Agent project.
create table if not exists public.orvex_profiles (
  telegram_id text primary key,
  display_name text not null check (char_length(display_name) between 1 and 60),
  email text not null default '' check (char_length(email) <= 120),
  interest text not null,
  updated_at timestamptz not null default now()
);

alter table public.orvex_profiles enable row level security;

-- The table is accessed only by the server-side service-role key.
-- Never put SUPABASE_SERVICE_ROLE_KEY in index.html or any browser bundle.
