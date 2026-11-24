-- 04200 -- Notification lifecycle: owner-only delete and a 10-item cap.
--
-- Every notification row is already written for one account_id. This pass adds
-- an owner-scoped delete and keeps only the ten newest rows per account so the
-- full notification page cannot grow without bound.

create or replace function smartgov.delete_notification(
  p_session_token text,
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  delete from smartgov.notifications
   where id = p_notification_id
     and account_id = v_account.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.delete_notification(text, uuid) from public;


create or replace function smartgov.prune_account_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  delete from smartgov.notifications n
   where n.account_id = NEW.account_id
     and n.id not in (
       select id
       from smartgov.notifications
       where account_id = NEW.account_id
       order by created_at desc, id desc
       limit 10
     );
  return null;
end;
$$;

drop trigger if exists sgov_notifications_cap on smartgov.notifications;
create trigger sgov_notifications_cap
after insert on smartgov.notifications
for each row execute function smartgov.prune_account_notifications();

-- Bring accounts that predate the cap down to ten as well.
with ranked as (
  select id,
         row_number() over (
           partition by account_id
           order by created_at desc, id desc
         ) as rn
  from smartgov.notifications
)
delete from smartgov.notifications n
using ranked r
where n.id = r.id and r.rn > 10;

notify pgrst, 'reload schema';
