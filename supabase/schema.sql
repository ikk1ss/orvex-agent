-- Run this file in the Supabase SQL Editor for the ORVEX Agent project.
create table if not exists public.orvex_profiles (
  telegram_id text primary key,
  display_name text not null check (char_length(display_name) between 1 and 60),
  email text not null default '' check (char_length(email) <= 120),
  interest text not null,
  preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object'),
  updated_at timestamptz not null default now()
);

-- Keep this migration safe for projects where the profile table already exists.
-- Existing profiles receive empty preferences without losing any profile data.
alter table public.orvex_profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object');

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


-- Balance is stored in kopecks (1 RUB = 100 kopecks) as an integer to avoid
-- floating point errors. The dollar amount is derived on the server from the
-- current exchange rate and is never stored.
-- Rows are created or changed only by trusted server-side code (service_role).
create table if not exists public.orvex_balances (
  telegram_id text primary key,
  balance_kopecks bigint not null default 0 check (balance_kopecks >= 0),
  updated_at timestamptz not null default now()
);

alter table public.orvex_balances enable row level security;


-- Account deletion is performed in one database transaction.
-- The function is callable only by the server-side service_role.
create or replace function public.delete_orvex_account(p_telegram_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.orvex_memories
  where telegram_id = p_telegram_id;

  delete from public.orvex_balances
  where telegram_id = p_telegram_id;

  delete from public.orvex_profiles
  where telegram_id = p_telegram_id;
end;
$$;

revoke all on function public.delete_orvex_account(text) from public;
revoke all on function public.delete_orvex_account(text) from anon;
revoke all on function public.delete_orvex_account(text) from authenticated;
grant execute on function public.delete_orvex_account(text) to service_role;
