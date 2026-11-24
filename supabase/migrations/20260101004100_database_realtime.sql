-- 04100 -- Real-time signals for messages and notifications.
--
-- Supabase Realtime is safest here as a signal channel, not a data channel.
-- The app already has a custom session system, so RLS cannot identify the
-- browser as a particular account. Instead, triggers write a tiny row whose
-- only payload is an opaque account UUID and a kind. A subscriber still has to
-- call the normal authenticated API to read the actual message or notification.
-- Leaking "something changed" is harmless; leaking the message would not be.

create table if not exists public.realtime_events (
  id uuid primary key default gen_random_uuid(),
  channel uuid not null,
  kind text not null,
  created_at timestamptz not null default now()
);

create index if not exists realtime_events_channel_created_idx
  on public.realtime_events (channel, created_at desc);

grant select on public.realtime_events to anon, authenticated;


create or replace function public.sgov_queue_message_events()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  r record;
begin
  for r in
    select cp.account_id
    from smartgov.conversation_participants cp
    where cp.conversation_id = NEW.conversation_id
      and cp.deleted_at is null
  loop
    insert into public.realtime_events (channel, kind)
    values (r.account_id, 'message');
  end loop;

  -- Signals are ephemeral; keeping two hours is plenty for reconnecting tabs.
  delete from public.realtime_events where created_at < now() - interval '2 hours';
  return null;
end;
$$;

drop trigger if exists sgov_messages_realtime on smartgov.messages;
create trigger sgov_messages_realtime
after insert or update of body, unsent_at on smartgov.messages
for each row execute function public.sgov_queue_message_events();


create or replace function public.sgov_queue_notification_events()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  insert into public.realtime_events (channel, kind)
  values (NEW.account_id, 'notification');

  delete from public.realtime_events where created_at < now() - interval '2 hours';
  return null;
end;
$$;

drop trigger if exists sgov_notifications_realtime on smartgov.notifications;
create trigger sgov_notifications_realtime
after insert or update of read_at on smartgov.notifications
for each row execute function public.sgov_queue_notification_events();


do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'realtime_events'
  ) then
    alter publication supabase_realtime add table public.realtime_events;
  end if;
end $$;

notify pgrst, 'reload schema';
