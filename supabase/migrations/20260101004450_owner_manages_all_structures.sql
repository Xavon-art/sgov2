-- 04450 -- the USG owner may maintain every council beneath the umbrella.
--
-- The previous gate let an owner edit only the root unit. That made the owner an
-- approver of every LSG structure but not an author of any of them, which is the
-- opposite of the federated model: USG is the parent government that holds every
-- subgroup. `canRead` already covered the whole organization, and the unit id is
-- still resolved against `p_account.organization_id`, so widening `canEdit` to
-- the owner's own organization does not expose another organization's council.
--
-- LSG officers keep exactly the same seat/authorship rules as before. Committee
-- rows remain read-only for everyone through the existing `v_type <> 'committee'`
-- guard.

create or replace function smartgov.gov_unit_access(
  p_account  smartgov.accounts,
  p_unit_id  uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_type      public.unit_type;
  v_reviewer  boolean;
  v_seated    uuid[];
  v_visible   uuid[];
  v_authored  boolean;
begin
  if p_account.id is null or p_account.organization_id is null or p_unit_id is null then
    return jsonb_build_object('canRead', false, 'canEdit', false, 'isReviewer', false);
  end if;

  select gu.unit_type into v_type
    from public.governance_units gu
   where gu.id = p_unit_id
     and gu.organization_id = p_account.organization_id;

  if v_type is null then
    return jsonb_build_object('canRead', false, 'canEdit', false, 'isReviewer', false);
  end if;

  v_reviewer := p_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(p_account.id, p_account.organization_id);

  v_seated  := smartgov.gov_seated_unit_ids(p_account);
  v_visible := smartgov.gov_visible_unit_ids(p_account);

  v_authored := p_unit_id = any (smartgov.gov_authored_unit_ids(p_account));

  return jsonb_build_object(
    'canRead', v_reviewer or p_unit_id = any (v_visible) or v_authored,
    'canEdit', v_type <> 'committee'
               and (
                     p_unit_id = any (v_seated)
                     or v_authored
                     -- The owner maintains the umbrella and every unit under it.
                     or p_account.account_scope = 'owner'
                   ),
    'isReviewer', v_reviewer
  );
end;
$$;

revoke all on function smartgov.gov_unit_access(smartgov.accounts, uuid) from public;
