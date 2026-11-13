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
