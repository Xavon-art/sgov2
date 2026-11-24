-- 04400 -- Real-time signals for government structure drafts.
--
-- Structure edits are already written to smartgov.gov_structures by the
-- autosaving draft API. This migration only broadcasts a tiny signal when that
-- happens, using the same channel as messages and notifications: the payload is
-- an account UUID plus a kind, never the document itself. A browser still has to
-- call the normal authenticated structure API before it can read anything.

create or replace function public.sgov_queue_structure_events()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  r record;
begin
  for r in
    select distinct a.id
    from smartgov.accounts a
    where a.organization_id = NEW.organization_id
      and (
        a.account_scope = 'owner'
        or smartgov.is_org_reviewer(a.id, a.organization_id)
        or exists (
          select 1
          from smartgov.roster ro
          join smartgov.unit_memberships um
            on um.roster_id = ro.id
           and um.end_date is null
          where ro.account_id = a.id
            and um.unit_id = NEW.unit_id
        )
      )
  loop
    insert into public.realtime_events (channel, kind)
    values (r.id, 'structure');
  end loop;

  delete from public.realtime_events where created_at < now() - interval '2 hours';
  return null;
end;
$$;

drop trigger if exists sgov_structures_realtime on smartgov.gov_structures;
create trigger sgov_structures_realtime
after insert or update of document, status, term_label, starts_on, ends_on
on smartgov.gov_structures
for each row execute function public.sgov_queue_structure_events();

notify pgrst, 'reload schema';
