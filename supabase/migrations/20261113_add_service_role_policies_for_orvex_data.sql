create policy orvex_profiles_service_role_only
  on public.orvex_profiles
  for all to service_role
  using (true)
  with check (true);

create policy orvex_memories_service_role_only
  on public.orvex_memories
  for all to service_role
  using (true)
  with check (true);

create policy orvex_chat_messages_service_role_only
  on public.orvex_chat_messages
  for all to service_role
  using (true)
  with check (true);