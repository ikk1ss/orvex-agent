-- Store Google and anonymous Supabase Auth users separately from Telegram identities.
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
