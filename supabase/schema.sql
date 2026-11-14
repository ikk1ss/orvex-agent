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


-- Guest AI requests are counted per Supabase Auth user and UTC day.
create table if not exists public.orvex_guest_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  request_count integer not null default 0 check (request_count between 0 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.orvex_guest_usage enable row level security;
revoke all on table public.orvex_guest_usage from public, anon, authenticated;
grant all on table public.orvex_guest_usage to service_role;

create or replace function public.orvex_guest_quota(
  p_user_id uuid,
  p_consume boolean default false
)
returns table (
  allowed boolean,
  used integer,
  remaining integer,
  resets_at timestamptz
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_usage_date date := (now() at time zone 'UTC')::date;
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;

  if p_consume then
    insert into public.orvex_guest_usage (user_id, usage_date, request_count)
    values (p_user_id, v_usage_date, 1)
    on conflict (user_id, usage_date)
    do update
      set request_count = public.orvex_guest_usage.request_count + 1,
          updated_at = now()
      where public.orvex_guest_usage.request_count < 20
    returning request_count into v_count;

    if v_count is null then
      select usage.request_count
        into v_count
        from public.orvex_guest_usage as usage
       where usage.user_id = p_user_id
         and usage.usage_date = v_usage_date;

      return query
        select false,
               coalesce(v_count, 0),
               greatest(20 - coalesce(v_count, 0), 0),
               ((v_usage_date + 1)::timestamp at time zone 'UTC');
      return;
    end if;
  else
    select coalesce(max(usage.request_count), 0)
      into v_count
      from public.orvex_guest_usage as usage
     where usage.user_id = p_user_id
       and usage.usage_date = v_usage_date;
  end if;

  return query
    select v_count < 20,
           v_count,
           greatest(20 - v_count, 0),
           ((v_usage_date + 1)::timestamp at time zone 'UTC');
end;
$$;

revoke all on function public.orvex_guest_quota(uuid, boolean) from public, anon, authenticated;
grant execute on function public.orvex_guest_quota(uuid, boolean) to service_role;


-- Profiles and chat history for Google and anonymous Supabase Auth identities.
-- These records use Auth UUIDs and remain separate from Telegram IDs.
create table if not exists public.orvex_auth_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  email text not null default '' check (char_length(email) <= 120),
  interest text not null check (interest in (
    'Личный ИИ-помощник',
    'Мультиагентная система',
    'Автоматизация задач',
    'Все возможности'
  )),
  preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.orvex_auth_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 16000),
  created_at timestamptz not null default now()
);

create index if not exists orvex_auth_chat_messages_owner_created_idx
  on public.orvex_auth_chat_messages (user_id, created_at desc, id desc);

alter table public.orvex_auth_profiles enable row level security;
alter table public.orvex_auth_chat_messages enable row level security;

revoke all on table public.orvex_auth_profiles from public, anon, authenticated;
revoke all on table public.orvex_auth_chat_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.orvex_auth_profiles to service_role;
grant select, insert, delete on table public.orvex_auth_chat_messages to service_role;
