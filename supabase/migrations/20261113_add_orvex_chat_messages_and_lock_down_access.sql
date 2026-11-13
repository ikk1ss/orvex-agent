-- Persist Telegram bot conversation history and restrict direct browser-role access.
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

revoke all on table public.orvex_profiles from anon, authenticated;
revoke all on table public.orvex_memories from anon, authenticated;
revoke all on table public.orvex_chat_messages from anon, authenticated;

grant select, insert, update, delete on table public.orvex_profiles to service_role;
grant select, insert, update, delete on table public.orvex_memories to service_role;
grant select, insert, delete on table public.orvex_chat_messages to service_role;

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

  delete from public.orvex_profiles
  where telegram_id = p_telegram_id;
end;
$$;

revoke all on function public.delete_orvex_account(text) from public;
revoke all on function public.delete_orvex_account(text) from anon;
revoke all on function public.delete_orvex_account(text) from authenticated;
grant execute on function public.delete_orvex_account(text) to service_role;
