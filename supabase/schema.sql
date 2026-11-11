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

 
create table if not exists public.orvex_memories (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  content text not null check (char_length(content) between 1 and 1000),
  category text not null default 'note'
    check (category in ('preference', 'fact', 'goal', 'instruction', 'note')),
  created_at timestamptz not null default now()
);

create index if not exists orvex_memories_owner_created_idx
  on public.orvex_memories (telegram_id, created_at desc);

alter table public.orvex_memories enable row level security;

-- Memory rows are available only through the authenticated server API.
-- No anon/authenticated client policies are created.
