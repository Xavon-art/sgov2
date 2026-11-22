-- 03500 -- Restore the assignment/legacy filing paths while keeping automatic
-- event report requirements, and keep those requirements in sync for events
-- created outside the create_event_v2 wrapper.

create or replace function smartgov.sync_event_report_requirements_on_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  perform smartgov.sync_event_report_requirements(new.id);
  return null;
end;
$$;
revoke all on function smartgov.sync_event_report_requirements_on_event() from public;

drop trigger if exists event_report_requirements_event_sync on smartgov.events;
create trigger event_report_requirements_event_sync
after insert or update of organization_id, created_by, source, scope, unit_id, honor_status
on smartgov.events
for each row execute function smartgov.sync_event_report_requirements_on_event();

create or replace function smartgov.sync_event_report_requirements_on_scope()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform smartgov.sync_event_report_requirements(old.event_id);
    return null;
  end if;

  perform smartgov.sync_event_report_requirements(new.event_id);
  if tg_op = 'UPDATE' and old.event_id is distinct from new.event_id then
    perform smartgov.sync_event_report_requirements(old.event_id);
  end if;
  return null;
end;
$$;
revoke all on function smartgov.sync_event_report_requirements_on_scope() from public;

drop trigger if exists event_report_requirements_scope_sync on smartgov.event_scopes;
create trigger event_report_requirements_scope_sync
after insert or update or delete on smartgov.event_scopes
for each row execute function smartgov.sync_event_report_requirements_on_scope();

create or replace function smartgov.can_file_accomplishment(
  p_account smartgov.accounts,
  p_event_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select exists (
    select 1
      from smartgov.events e
     where e.id = p_event_id
       and e.organization_id = p_account.organization_id
       and e.cancelled_at is null
       and (
         smartgov.is_usg_side(p_account)
         or smartgov.is_event_assignee(p_account.id, e.id)
         or (
           e.honor_status <> 'not_honored'
           and (
             exists (
               select 1
                 from smartgov.event_report_requirements r
                where r.event_id = e.id
                  and r.unit_id = smartgov.my_lsg_unit(p_account)
                  and r.required
             )
             or (
               not exists (
                 select 1
                   from smartgov.event_report_requirements r
                  where r.event_id = e.id
                    and r.required
               )
               and e.source = 'lsg'
               and (e.created_by = p_account.id
                    or e.unit_id = smartgov.my_lsg_unit(p_account))
             )
           )
         )
       )
  );
$$;
revoke all on function smartgov.can_file_accomplishment(smartgov.accounts, uuid) from public;

create or replace function smartgov.submit_accomplishment_report_v2(
  p_session_token text,
  p_event_id uuid,
  p_narrative text,
  p_highlights text default '',
  p_attachment_submission_id uuid default null,
  p_file_paths text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  return smartgov.submit_accomplishment_report_v2_base(
    p_session_token, p_event_id, p_narrative, p_highlights,
    p_attachment_submission_id, p_file_paths
  );
end;
$$;
revoke all on function smartgov.submit_accomplishment_report_v2(text, uuid, text, text, uuid, text[]) from public;

select smartgov.sync_event_report_requirements(e.id) from smartgov.events e;
