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

alter table public.orvex_profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object');

alter table public.orvex_profiles enable row level security;

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

create table if not exists public.orvex_chat_messages (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 16000),
  created_at timestamptz not null default now()
);

create index if not exists orvex_chat_messages_owner_created_idx
  on public.orvex_chat_messages (telegram_id, created_at desc, id desc);

alter table public.orvex_chat_messages enable row level security;

create policy orvex_profiles_service_role_only
  on public.orvex_profiles for all to service_role using (true) with check (true);

create policy orvex_memories_service_role_only
  on public.orvex_memories for all to service_role using (true) with check (true);

create policy orvex_chat_messages_service_role_only
  on public.orvex_chat_messages for all to service_role using (true) with check (true);

-- Browser roles do not access these tables directly. The Mini App uses
-- authenticated server API routes, which use the server-side service key.
revoke all on table public.orvex_profiles from anon, authenticated;
revoke all on table public.orvex_memories from anon, authenticated;
revoke all on table public.orvex_chat_messages from anon, authenticated;

grant select, insert, update, delete on table public.orvex_profiles to service_role;
grant select, insert, update, delete on table public.orvex_memories to service_role;
grant select, insert, delete on table public.orvex_chat_messages to service_role;

-- Account deletion removes profile, personal memory and conversation history atomically.

-- Balance is stored in kopecks (1 RUB = 100 kopecks) as an integer to avoid
-- floating point errors. The dollar amount is derived on the server from
-- the current exchange rate and is never stored.
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
  delete from public.orvex_chat_messages
  where telegram_id = p_telegram_id;

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
