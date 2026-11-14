-- Keep account deletion consistent with the balance table introduced on main.
-- This follow-up migration is safe for projects where the earlier deletion
-- function migration has already been applied.
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
