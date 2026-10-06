-- 03010 -- government structure: let the records outlive the account, and the
-- organization go away.
--
-- `gov_structures.created_by` and `gov_structure_reviews.decided_by` were the two
-- author columns created without a delete action, while their own siblings --
-- `submitted_by` and the structure-level `decided_by` -- were given
-- `on delete set null`. The result was that removing an organization failed:
-- `gov_structure_reviews.decided_by` still pointed at an account that the
-- organization cascade was trying to remove, and the delete stopped. An audit trail
-- that prevents anybody from ever deleting their council is not an audit trail.
--
-- Both become nullable with `on delete set null`, matching 02950's stated intent.
-- Losing the name of who pressed approve is strictly better than losing the record
-- that they approved, and the row keeps its decision, revision and timestamp.
--
-- The follow-on fix is in `get_structure`: a null author is nobody's draft, so a
-- reviewer must not suddenly be able to read it.

alter table smartgov.gov_structures
  drop constraint gov_structures_created_by_fkey;

alter table smartgov.gov_structures
  alter column created_by drop not null;

alter table smartgov.gov_structures
  add constraint gov_structures_created_by_fkey
  foreign key (created_by) references smartgov.accounts (id) on delete set null;

alter table smartgov.gov_structure_reviews
  drop constraint gov_structure_reviews_decided_by_fkey;

alter table smartgov.gov_structure_reviews
  alter column decided_by drop not null;

alter table smartgov.gov_structure_reviews
  add constraint gov_structure_reviews_decided_by_fkey
  foreign key (decided_by) references smartgov.accounts (id) on delete set null;

create or replace function smartgov.get_structure(
  p_session_token text,
  p_unit_id       uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_access  jsonb;
  v_root    uuid;
  v_open    smartgov.gov_structures%rowtype;
  v_live    smartgov.gov_structures%rowtype;
  v_hidden  boolean := false;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_unit_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);

  if not (v_access->>'canRead')::boolean then
    -- A unit this caller cannot read is reported as missing, not as forbidden:
    -- distinguishing them would confirm the existence of another council's unit
    -- to someone holding only a publishable key.
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_root := smartgov.gov_root_unit(v_account.organization_id);

  select * into v_open
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status in ('draft','submitted','returned');

  select * into v_live
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status = 'approved';

  -- `created_by` is nullable now that an account's deletion nulls it, so this has to
  -- be an explicit comparison. `created_by <> v_account.id` would evaluate to null
  -- for a departed author and read as "not hidden" -- which would hand a reviewer
  -- the draft of a council whose author no longer has an account.
  if v_open.id is not null
     and v_open.status in ('draft','returned')
     and (v_open.created_by is null or v_open.created_by <> v_account.id) then
    v_hidden := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'unit', (
      select jsonb_build_object(
               'id', gu.id,
               'name', gu.name,
               'unitType', gu.unit_type,
               'parentId', gu.parent_id,
               'parentName', (select p.name from public.governance_units p where p.id = gu.parent_id),
               'isRoot', gu.id = v_root
             )
        from public.governance_units gu
       where gu.id = p_unit_id
    ),
    'capability', v_access,
    'draft', case when v_open.id is null or v_hidden then null
                  else smartgov.gov_structure_json(v_open) end,
    'approved', case when v_live.id is null then null
                     else smartgov.gov_structure_json(v_live) end,
    'history', coalesce((
      select jsonb_agg(t.entry order by t.created_at desc)
        from (
          select s.created_at,
                 smartgov.gov_structure_json(s) as entry
            from smartgov.gov_structures s
           where s.unit_id = p_unit_id
             and not (s.id = coalesce(v_live.id, '00000000-0000-0000-0000-000000000000'::uuid))
             and (not v_hidden or s.id <> v_open.id)
        ) t
    ), '[]'::jsonb),
    -- What the dashboard's Renew button needs, without it having to read the
    -- whole structure to decide whether to offer itself. A hidden draft still
    -- blocks renewal: the author is not the one asking, so it is not their slot to
    -- overwrite.
    'renewal', jsonb_build_object(
      'canRequest', (v_access->>'canEdit')::boolean
                    and v_live.id is not null
                    and (v_open.id is null or v_open.created_by = v_account.id),
      'label', v_live.term_label,
      'startsOn', v_live.starts_on,
      'endsOn', v_live.ends_on,
      'daysRemaining', case when v_live.id is null then null
                           else (v_live.ends_on - current_date) end,
      'expired', v_live.ends_on < current_date
    )
  );
end;
$$;

revoke all on function smartgov.get_structure(text, uuid) from public;

create or replace function public.get_structure(p_session_token text, p_unit_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_structure(p_session_token, p_unit_id); $$;
revoke all on function public.get_structure(text, uuid) from public;
grant execute on function public.get_structure(text, uuid) to anon, authenticated;