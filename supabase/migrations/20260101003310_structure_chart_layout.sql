-- 03310 -- government structure: chart layout, tiers, and safe concurrent saves.
--
-- The structure document gains a presentation layer without losing the shape the
-- seat model already reads. Everything here is additive and every read upgrades
-- old documents in place, so an approved structure written before this migration
-- still loads and still renders.
--
-- What is added:
--
--   * `schemaVersion` (2) and `layout` at the top of the document.
--   * Per position: `tier`, `order`, `parentKey`, `group`, `maxHolders`.
--   * Per holder: `fullName`, `nickname`, `suffix`, `termNote`, and an optional
--     `holders` array (the first is the seated holder, the rest are co-holders
--     the chart displays; the one-active-holder-per-seat index is unchanged).
--   * An optimistic-concurrency save (`save_structure_draft_v2`) that refuses a
--     write built on a revision the database has already moved past.
--   * A whole-organization read of the published root structure, so every member
--     can view the chart without learning another council's unit id.

-- ------------------------------------------------------------ document upgrade

-- Idempotent and presentation-only. A legacy document gets schemaVersion 2 and
-- a chart layout; its committees keep their order, and each seat gets a tier
-- derived from the committee it sits in (the council board at the top, standing
-- committees one level below). Anything already carrying a field keeps it.
create or replace function smartgov.gov_document_upgrade(p_document jsonb)
returns jsonb
language sql immutable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  with committees as (
    select c.value as committee,
           c.ord   as c_ord,
           coalesce((c.value->>'isUnit')::boolean, false) as is_unit
      from jsonb_array_elements(
             case when jsonb_typeof(p_document->'committees') = 'array'
                  then p_document->'committees' else '[]'::jsonb end)
           with ordinality as c(value, ord)
  ),
  upgraded as (
    select c.c_ord,
           c.committee || jsonb_build_object(
             'positions',
             coalesce((
               select jsonb_agg(
                        p.value || jsonb_build_object(
                          'tier',
                          case when (p.value->>'tier') ~ '^\d+$'
                               then (p.value->>'tier')::int
                               else case when c.is_unit then 0 else 1 end end,
                          'order',
                          case when (p.value->>'order') ~ '^\d+$'
                               then (p.value->>'order')::int
                               else (p.ord - 1)::int end,
                          'maxHolders',
                          case when (p.value->>'maxHolders') ~ '^\d+$'
                               then greatest(0, least(20, (p.value->>'maxHolders')::int))
                               else 1 end
                        )
                        || case
                             when jsonb_typeof(p.value->'holder') = 'object'
                              and p.value->'holder' <> '{}'::jsonb
                             then jsonb_build_object(
                               'holder',
                               p.value->'holder' || case
                                 when coalesce(p.value->'holder'->>'fullName', '') = ''
                                  and btrim(concat_ws(' ',
                                        coalesce(p.value->'holder'->>'firstName', ''),
                                        coalesce(p.value->'holder'->>'middleName', ''),
                                        coalesce(p.value->'holder'->>'lastName', ''))) <> ''
                                 then jsonb_build_object('fullName',
                                        btrim(concat_ws(' ',
                                          coalesce(p.value->'holder'->>'firstName', ''),
                                          coalesce(p.value->'holder'->>'middleName', ''),
                                          coalesce(p.value->'holder'->>'lastName', ''))))
                                 else '{}'::jsonb end,
                               'holders',
                               coalesce((
                                 select jsonb_agg(h.value order by h.ord)
                                   from jsonb_array_elements(
                                          case when jsonb_typeof(p.value->'holders') = 'array'
                                               then p.value->'holders'
                                               else jsonb_build_array(p.value->'holder') end)
                                        with ordinality as h(value, ord)
                               ), '[]'::jsonb))
                             else '{}'::jsonb
                           end
                        order by p.ord)
                 from jsonb_array_elements(
                        case when jsonb_typeof(c.committee->'positions') = 'array'
                             then c.committee->'positions' else '[]'::jsonb end)
                      with ordinality as p(value, ord)
             ), '[]'::jsonb)
           ) as committee
      from committees c
  )
  select case
           when jsonb_typeof(p_document) <> 'object'
             or jsonb_typeof(p_document->'committees') <> 'array'
             then p_document
           else p_document
                || jsonb_build_object(
                     'schemaVersion', 2,
                     'layout', coalesce(
                       case when jsonb_typeof(p_document->'layout') = 'object'
                            then p_document->'layout' end,
                       '{"template":"hierarchy","orientation":"vertical",
                         "theme":"parchment","showPhotos":true,"showTitles":true,
                         "tierSpacing":1,"nodeSize":"md"}'::jsonb))
                || jsonb_build_object(
                     'committees',
                     coalesce((select jsonb_agg(u.committee order by u.c_ord)
                                 from upgraded u), '[]'::jsonb))
         end;
$$;

revoke all on function smartgov.gov_document_upgrade(jsonb) from public;

-- ---------------------------------------------------------- photo bookkeeping

-- One holder, flagged and pointed at their roster row. `rosterId` is what lets a
-- chart fetch the stored photo for each node without a second match call; the
-- value is an opaque uuid scoped to this organization.
create or replace function smartgov.gov_mark_holder(
  p_organization uuid,
  p_holder       jsonb
)
returns jsonb
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select case
           when jsonb_typeof(p_holder) <> 'object' or p_holder = '{}'::jsonb
             then p_holder
           else p_holder || jsonb_build_object(
                  'hasPhoto', coalesce((
                     select r.photo_oid is not null
                       from smartgov.roster r
                      where r.organization_id = p_organization
                        and lower(r.email) = lower(btrim(coalesce(p_holder->>'email', '')))
                      limit 1), false),
                  'rosterId', (
                     select r.id
                       from smartgov.roster r
                      where r.organization_id = p_organization
                        and lower(r.email) = lower(btrim(coalesce(p_holder->>'email', '')))
                      limit 1))
         end;
$$;

revoke all on function smartgov.gov_mark_holder(uuid, jsonb) from public;

-- Reads still never carry bytes, but they now carry the flag and the roster id
-- for the seated holder *and* for every co-holder.
create or replace function smartgov.gov_mark_existing_photos(
  p_organization uuid,
  p_document     jsonb
)
returns jsonb
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select case
    when jsonb_typeof(p_document) <> 'object'
      or jsonb_typeof(p_document->'committees') <> 'array'
      then p_document
    else p_document || jsonb_build_object(
           'committees',
           coalesce((
             select jsonb_agg(
                      jsonb_set(
                        c.value, '{positions}',
                        coalesce(
                          (select jsonb_agg(
                                    case
                                      when jsonb_typeof(p.value->'holder') = 'object'
                                      then jsonb_set(
                                             p.value, '{holder}',
                                             smartgov.gov_mark_holder(p_organization, p.value->'holder'))
                                      else p.value
                                    end
                                    || case
                                         when jsonb_typeof(p.value->'holders') = 'array'
                                         then jsonb_build_object(
                                                'holders',
                                                (select jsonb_agg(
                                                          smartgov.gov_mark_holder(p_organization, h.value)
                                                          order by h.ord)
                                                   from jsonb_array_elements(p.value->'holders')
                                                        with ordinality as h(value, ord)))
                                         else '{}'::jsonb
                                       end
                                    order by p.ord)
                             from jsonb_array_elements(
                                    case when jsonb_typeof(c.value->'positions') = 'array'
                                         then c.value->'positions' else '[]'::jsonb end)
                             with ordinality as p(value, ord)
                          ), '[]'::jsonb)
                      )
                      order by c.ord)
               from jsonb_array_elements(p_document->'committees')
               with ordinality as c(value, ord)
           ), '[]'::jsonb))
  end;
$$;

revoke all on function smartgov.gov_mark_existing_photos(uuid, jsonb) from public;

-- Photos are stripped from the seated holder and from every co-holder.
create or replace function smartgov.gov_strip_photos(p_document jsonb)
returns jsonb
language sql immutable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select case
    when jsonb_typeof(p_document) <> 'object'
      or jsonb_typeof(p_document->'committees') <> 'array'
      then p_document
    else p_document || jsonb_build_object(
           'committees',
           coalesce((
             select jsonb_agg(
                      jsonb_set(
                        c.value, '{positions}',
                        coalesce(
                          (select jsonb_agg(
                                    case when jsonb_typeof(p.value->'holder') = 'object'
                                         then jsonb_set(p.value, '{holder}',
                                                        (p.value->'holder') - 'photo')
                                         else p.value
                                    end
                                    || case
                                         when jsonb_typeof(p.value->'holders') = 'array'
                                         then jsonb_build_object(
                                                'holders',
                                                (select jsonb_agg(h.value - 'photo' order by h.ord)
                                                   from jsonb_array_elements(p.value->'holders')
                                                        with ordinality as h(value, ord)))
                                         else '{}'::jsonb
                                       end
                                    order by p.ord)
                             from jsonb_array_elements(
                                    case when jsonb_typeof(c.value->'positions') = 'array'
                                         then c.value->'positions' else '[]'::jsonb end)
                             with ordinality as p(value, ord)
                          ), '[]'::jsonb)
                      )
                      order by c.ord)
               from jsonb_array_elements(p_document->'committees')
               with ordinality as c(value, ord)
           ), '[]'::jsonb))
  end;
$$;

revoke all on function smartgov.gov_strip_photos(jsonb) from public;

-- ---------------------------------------------------------------- validation

-- The parent of a seat, by key, within one document. Used by the cycle walk.
create or replace function smartgov.gov_position_parent(
  p_document jsonb,
  p_key      text
)
returns text
language sql immutable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select nullif(btrim(coalesce(p.value->>'parentKey', '')), '')
    from jsonb_array_elements(
           case when jsonb_typeof(p_document->'committees') = 'array'
                then p_document->'committees' else '[]'::jsonb end) c
    cross join lateral jsonb_array_elements(
           case when jsonb_typeof(c.value->'positions') = 'array'
                then c.value->'positions' else '[]'::jsonb end) p
   where btrim(coalesce(p.value->>'key', '')) = btrim(p_key)
   limit 1;
$$;

revoke all on function smartgov.gov_position_parent(jsonb, text) from public;

-- Same contract as the 02960/02980 validator, plus the presentation fields.
-- A document without any of them still validates: the chart upgrades on read.
create or replace function smartgov.gov_document_valid(
  p_document      jsonb,
  p_allow_holders boolean default true
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_committees jsonb;
  v_ci         int;
  v_pi         int;
  v_c          jsonb;
  v_p          jsonb;
  v_h          jsonb;
  v_list       jsonb;
  v_key        text;
  v_title      text;
  v_seen_c     text[] := '{}';
  v_all_p      text[] := '{}';
  v_email      text;
  v_name       text;
  v_seen_unit  boolean := false;
  v_tier       int;
  v_order      int;
  v_max        int;
  v_parent     text;
  v_walk       text;
  v_steps      int;
  v_holder_ix  int;
begin
  if jsonb_typeof(p_document) <> 'object'
     or jsonb_typeof(p_document->'committees') <> 'array'
     or jsonb_array_length(p_document->'committees') < 1
     or jsonb_array_length(p_document->'committees') > 30 then
    return jsonb_build_object(
      'ok', false, 'reason', 'invalid_request',
      'detail', 'A structure needs between 1 and 30 committees.');
  end if;

  if p_document ? 'schemaVersion'
     and (p_document->>'schemaVersion') !~ '^[12]$' then
    return jsonb_build_object(
      'ok', false, 'reason', 'invalid_request',
      'detail', 'This structure was written by a newer version of the chart.');
  end if;

  if p_document ? 'layout' then
    if jsonb_typeof(p_document->'layout') <> 'object' then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', 'The chart layout is malformed.');
    end if;

    if coalesce(p_document->'layout'->>'template', 'hierarchy')
       not in ('hierarchy','pyramid','matrix','columns','radial','compact') then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', 'That chart template is not one of the six.');
    end if;

    if coalesce(p_document->'layout'->>'orientation', 'vertical')
       not in ('vertical','horizontal') then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', 'The chart orientation must be vertical or horizontal.');
    end if;

    if coalesce(p_document->'layout'->>'theme', 'parchment')
       not in ('parchment','ink','brass','slate') then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', 'That chart theme is not available.');
    end if;

    if coalesce(p_document->'layout'->>'nodeSize', 'md')
       not in ('sm','md','lg') then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', 'That node size is not available.');
    end if;

    if (p_document->'layout'->>'tierSpacing') is not null
       and (p_document->'layout'->>'tierSpacing') !~ '^[0-9]+(\.[0-9]+)?$' then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', 'The tier spacing must be a number.');
    end if;
  end if;

  v_committees := p_document->'committees';

  -- Pass 1: every seat key, globally. A key is the drag identity of a node and
  -- the target of `parentKey`, so it cannot be unique merely per committee.
  for v_ci in 0 .. jsonb_array_length(v_committees) - 1 loop
    v_c := v_committees->v_ci;

    if jsonb_typeof(v_c->'positions') = 'array' then
      for v_pi in 0 .. jsonb_array_length(v_c->'positions') - 1 loop
        v_p := v_c->'positions'->v_pi;
        v_key := btrim(coalesce(v_p->>'key', ''));

        if length(v_key) < 1 or length(v_key) > 60 then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_request',
            'detail', format('A seat in "%s" has no usable key.',
                             btrim(coalesce(v_c->>'name', ''))));
        end if;

        if v_key = any (v_all_p) then
          return jsonb_build_object(
            'ok', false, 'reason', 'duplicate_position_key',
            'detail', format('Two seats share the key "%s".', v_key));
        end if;
        v_all_p := array_append(v_all_p, v_key);
      end loop;
    end if;
  end loop;

  -- Pass 2: the rules.
  for v_ci in 0 .. jsonb_array_length(v_committees) - 1 loop
    v_c := v_committees->v_ci;
    v_key := btrim(coalesce(v_c->>'key', ''));

    if length(v_key) < 1 or length(v_key) > 60 then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', format('Committee %s has no usable key.', v_ci + 1));
    end if;

    if v_key = any (v_seen_c) then
      return jsonb_build_object(
        'ok', false, 'reason', 'duplicate_committee_key',
        'detail', format('Two committees share the key "%s".', v_key));
    end if;
    v_seen_c := array_append(v_seen_c, v_key);

    if coalesce((v_c->>'isUnit')::boolean, false) then
      if v_ci > 0 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', 'Only the first committee can be the council itself.');
      end if;
      v_seen_unit := true;
    end if;

    if length(btrim(coalesce(v_c->>'name', ''))) not between 1 and 120 then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', format('Committee "%s" needs a name of 1 to 120 characters.', v_key));
    end if;

    if length(coalesce(v_c->>'description', '')) > 400 then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', format('The description for "%s" is too long.', v_key));
    end if;

    if jsonb_typeof(v_c->'positions') <> 'array'
       or jsonb_array_length(v_c->'positions') < 1
       or jsonb_array_length(v_c->'positions') > 40 then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', format('"%s" needs between 1 and 40 seats.', v_key));
    end if;

    for v_pi in 0 .. jsonb_array_length(v_c->'positions') - 1 loop
      v_p := v_c->'positions'->v_pi;
      v_key := btrim(coalesce(v_p->>'key', ''));
      v_title := btrim(coalesce(v_p->>'title', ''));

      if length(v_title) not between 1 and 80 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('A seat in "%s" needs a title of 1 to 80 characters.',
                           btrim(coalesce(v_c->>'name', ''))));
      end if;

      v_tier  := case when (v_p->>'tier') ~ '^\d+$' then (v_p->>'tier')::int else 0 end;
      v_order := case when (v_p->>'order') ~ '^\d+$' then (v_p->>'order')::int else 0 end;
      v_max   := case when (v_p->>'maxHolders') ~ '^\d+$'
                      then (v_p->>'maxHolders')::int else 1 end;

      if v_tier > 12 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('"%s" is on a tier deeper than the chart allows.', v_title));
      end if;

      if v_order > 999 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('"%s" has an invalid position in its tier.', v_title));
      end if;

      if v_max > 20 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('"%s" cannot have more than 20 holders.', v_title));
      end if;

      if length(coalesce(v_p->>'group', '')) > 60 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('The group for "%s" is too long.', v_title));
      end if;

      v_parent := nullif(btrim(coalesce(v_p->>'parentKey', '')), '');

      if v_parent is not null then
        if not (v_parent = any (v_all_p)) then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_parent',
            'detail', format('"%s" hangs off a seat that is not in this structure.', v_title));
        end if;

        if v_parent = v_key then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_parent',
            'detail', format('"%s" cannot report to itself.', v_title));
        end if;

        v_walk := v_parent;
        v_steps := 0;
        while v_walk is not null and v_walk <> '' loop
          v_steps := v_steps + 1;
          if v_steps > 13 then
            return jsonb_build_object(
              'ok', false, 'reason', 'invalid_parent',
              'detail', format('The reporting line through "%s" loops.', v_title));
          end if;
          if v_walk = v_key then
            return jsonb_build_object(
              'ok', false, 'reason', 'invalid_parent',
              'detail', format('The reporting line through "%s" loops.', v_title));
          end if;
          v_walk := smartgov.gov_position_parent(p_document, v_walk);
        end loop;
      end if;

      -- Seated holder plus co-holders. `holders` wins when present; `holder`
      -- stays the first entry so the seat model keeps reading the same field.
      v_list := case
                  when jsonb_typeof(v_p->'holders') = 'array' then v_p->'holders'
                  when jsonb_typeof(v_p->'holder') = 'object'
                       and v_p->'holder' <> '{}'::jsonb then jsonb_build_array(v_p->'holder')
                  else '[]'::jsonb
                end;

      if jsonb_array_length(v_list) > v_max then
        return jsonb_build_object(
          'ok', false, 'reason', 'too_many_holders',
          'detail', format('"%s" allows %s holder(s) but names %s.',
                           v_title, v_max, jsonb_array_length(v_list)));
      end if;

      if v_max = 0 and jsonb_array_length(v_list) > 0 then
        return jsonb_build_object(
          'ok', false, 'reason', 'too_many_holders',
          'detail', format('"%s" is configured as vacant-only.', v_title));
      end if;

      for v_holder_ix in 0 .. jsonb_array_length(v_list) - 1 loop
        v_h := v_list->v_holder_ix;

        if jsonb_typeof(v_h) <> 'object' or v_h = '{}'::jsonb then
          continue;
        end if;

        if not p_allow_holders then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_request',
            'detail', format('A template cannot name people, but "%s / %s" does.',
                             btrim(coalesce(v_c->>'name', '')), v_title));
        end if;

        v_email := lower(btrim(coalesce(v_h->>'email', '')));
        v_name  := btrim(concat_ws(' ',
                      coalesce(v_h->>'firstName', ''),
                      coalesce(v_h->>'middleName', ''),
                      coalesce(v_h->>'lastName', '')));

        if v_name = '' then
          v_name := btrim(coalesce(v_h->>'fullName', ''));
        end if;

        if v_email = '' or position('@' in v_email) < 2
           or length(v_email) > 254 then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_request',
            'detail', format('"%s" needs a valid email address.', v_title));
        end if;

        if length(v_name) not between 1 and 200 then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_request',
            'detail', format('"%s" needs a name.', v_title));
        end if;

        if length(coalesce(v_h->>'fullName', '')) > 200
           or length(coalesce(v_h->>'nickname', '')) > 60
           or length(coalesce(v_h->>'suffix', '')) > 20
           or length(coalesce(v_h->>'termNote', '')) > 120 then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_request',
            'detail', format('"%s" has a field that is too long.', v_title));
        end if;

        if v_h ? 'photo'
           and length(coalesce(v_h->>'photo', '')) > 1048576 then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_request',
            'detail', format('The photo for "%s" is too large.', v_title));
        end if;

        if coalesce(v_h->>'gender', 'prefer_not_to_say')
           not in ('female','male','other','prefer_not_to_say') then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_request',
            'detail', format('"%s" has an unrecognised gender value.', v_title));
        end if;

        if coalesce(v_h->>'birthdate', '') <> ''
           and (v_h->>'birthdate') !~ '^\d{4}-\d{2}-\d{2}$' then
          return jsonb_build_object(
            'ok', false, 'reason', 'invalid_request',
            'detail', format('"%s" has a malformed birthdate.', v_title));
        end if;
      end loop;
    end loop;
  end loop;

  if not v_seen_unit then
    return jsonb_build_object(
      'ok', true, 'warning', 'no_unit_committee');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.gov_document_valid(jsonb, boolean) from public;

-- --------------------------------------------------------------- write: draft

-- Optimistic concurrency. A chart editor autosaves, so two tabs or a stale tab
-- would otherwise overwrite each other silently. When the caller says which
-- `updatedAt` it built on, a mismatch is a `conflict` carrying the current one.
create or replace function smartgov.save_structure_draft_v2(
  p_session_token        text,
  p_unit_id              uuid,
  p_template_key         text,
  p_term_label           text,
  p_starts_on            date,
  p_ends_on              date,
  p_document             jsonb,
  p_note                 text,
  p_expected_updated_at  timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_access    jsonb;
  v_valid     jsonb;
  v_document  jsonb;
  v_struct    smartgov.gov_structures%rowtype;
  v_root      uuid;
  v_previous  timestamptz;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);
  if not (v_access->>'canEdit')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not smartgov.consume_rate_limit(
       'structure:save:' || v_account.id::text, 120, interval '5 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if length(btrim(coalesce(p_term_label, ''))) not between 1 and 80
     or p_starts_on is null or p_ends_on is null
     or p_ends_on <= p_starts_on then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- Upgrade first: the validator has to see the same fields the renderer will,
  -- and the stored draft should not need upgrading on every later read.
  v_document := smartgov.gov_document_upgrade(p_document);

  v_valid := smartgov.gov_document_valid(v_document);
  if not (v_valid->>'ok')::boolean then
    return v_valid;
  end if;

  v_root := smartgov.gov_root_unit(v_account.organization_id);

  select * into v_struct
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status in ('draft','submitted','returned')
   for update;

  if v_struct.id is not null then
    if v_struct.status = 'submitted' then
      return jsonb_build_object('ok', false, 'reason', 'awaiting_review');
    end if;

    if p_expected_updated_at is not null
       and v_struct.updated_at is distinct from p_expected_updated_at then
      return jsonb_build_object(
        'ok', false, 'reason', 'conflict',
        'detail', 'This structure was changed somewhere else.',
        'updatedAt', v_struct.updated_at,
        'status', v_struct.status,
        'revision', v_struct.revision);
    end if;

    v_previous := v_struct.updated_at;

    update smartgov.gov_structures s
       set template_key = coalesce(nullif(btrim(coalesce(p_template_key, '')), ''), s.template_key),
           term_label = btrim(p_term_label),
           starts_on = p_starts_on,
           ends_on = p_ends_on,
           document = v_document,
           note = left(btrim(coalesce(p_note, '')), 1000),
           status = 'draft',
           revision = case
                        when s.status = 'returned'
                          or s.document is distinct from v_document
                          or s.starts_on is distinct from p_starts_on
                          or s.ends_on is distinct from p_ends_on
                          or s.term_label is distinct from btrim(p_term_label)
                        then s.revision + 1
                        else s.revision
                      end,
           -- `now()` can equal the previous timestamp inside one transaction.
           -- The conflict check compares for inequality, so the update must move.
           updated_at = greatest(now(), coalesce(v_previous, now()) + interval '1 microsecond')
     where s.id = v_struct.id
     returning * into v_struct;
  else
    insert into smartgov.gov_structures (
      organization_id, unit_id, author_kind, created_by, template_key,
      term_label, starts_on, ends_on, status, document, note
    ) values (
      v_account.organization_id, p_unit_id,
      case when p_unit_id = v_root then 'usg' else 'lsg' end,
      v_account.id, nullif(btrim(coalesce(p_template_key, '')), ''),
      btrim(p_term_label), p_starts_on, p_ends_on, 'draft', v_document,
      left(btrim(coalesce(p_note, '')), 1000)
    ) returning * into v_struct;
  end if;

  return jsonb_build_object(
    'ok', true,
    'structureId', v_struct.id,
    'status', v_struct.status,
    'revision', v_struct.revision,
    'authorKind', v_struct.author_kind,
    'updatedAt', v_struct.updated_at
  );
end;
$$;

revoke all on function smartgov.save_structure_draft_v2(text, uuid, text, text, date, date, jsonb, text, timestamptz) from public;

-- The old signature stays, delegating with no concurrency token. Existing
-- callers (and the probe scripts) keep working unchanged.
create or replace function smartgov.save_structure_draft(
  p_session_token text,
  p_unit_id       uuid,
  p_template_key  text,
  p_term_label    text,
  p_starts_on     date,
  p_ends_on       date,
  p_document      jsonb,
  p_note          text
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.save_structure_draft_v2(
    p_session_token, p_unit_id, p_template_key, p_term_label,
    p_starts_on, p_ends_on, p_document, p_note, null);
$$;

revoke all on function smartgov.save_structure_draft(text, uuid, text, text, date, date, jsonb, text) from public;

-- --------------------------------------------------------------- read payloads

-- Every structure read upgrades before it strips and marks, so a client never
-- sees a document with half a layout and has nothing to migrate in the browser.
create or replace function smartgov.gov_structure_json(p_s smartgov.gov_structures)
returns jsonb
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select jsonb_build_object(
    'id', p_s.id,
    'unitId', p_s.unit_id,
    'authorKind', p_s.author_kind,
    'status', p_s.status,
    'revision', p_s.revision,
    'templateKey', p_s.template_key,
    'termLabel', p_s.term_label,
    'startsOn', p_s.starts_on,
    'endsOn', p_s.ends_on,
    'document', smartgov.gov_mark_existing_photos(
                   p_s.organization_id,
                   smartgov.gov_strip_photos(
                     smartgov.gov_document_upgrade(p_s.document))),
    'note', p_s.note,
    'submittedBy', (select a.display_name from smartgov.accounts a where a.id = p_s.submitted_by),
    'submittedAt', p_s.submitted_at,
    'decidedBy',   (select a.display_name from smartgov.accounts a where a.id = p_s.decided_by),
    'decidedAt',   p_s.decided_at,
    'decisionRemark', p_s.decision_remark,
    'renewsId', p_s.renews_id,
    'renewsTermLabel', (select t.term_label from smartgov.gov_structures t where t.id = p_s.renews_id),
    'createdAt', p_s.created_at,
    'updatedAt', p_s.updated_at
  );
$$;

revoke all on function smartgov.gov_structure_json(smartgov.gov_structures) from public;

-- The whole organization's published root structure, addressed without knowing
-- the root unit's id. Any member of the organization may read it; the answer is
-- the same approved chart the USG sees.
create or replace function smartgov.get_org_structure(p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_root    uuid;
  v_live    smartgov.gov_structures%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_root := smartgov.gov_root_unit(v_account.organization_id);

  if v_root is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_live
    from smartgov.gov_structures s
   where s.unit_id = v_root
     and s.status = 'approved'
   order by s.decided_at desc nulls last, s.updated_at desc
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'unit', (select jsonb_build_object(
                      'id', gu.id,
                      'name', gu.name,
                      'unitType', gu.unit_type,
                      'isRoot', true)
               from public.governance_units gu
              where gu.id = v_root),
    'structure', case when v_live.id is null then null
                      else smartgov.gov_structure_json(v_live) end
  );
end;
$$;

revoke all on function smartgov.get_org_structure(text) from public;

-- --------------------------------------------------------------- public doors

create or replace function public.save_structure_draft_v2(
  p_session_token       text,
  p_unit_id             uuid,
  p_template_key        text,
  p_term_label          text,
  p_starts_on           date,
  p_ends_on             date,
  p_document            jsonb,
  p_note                text,
  p_expected_updated_at timestamptz default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.save_structure_draft_v2(
    p_session_token, p_unit_id, p_template_key, p_term_label,
    p_starts_on, p_ends_on, p_document, p_note, p_expected_updated_at);
$$;

revoke all on function public.save_structure_draft_v2(text, uuid, text, text, date, date, jsonb, text, timestamptz) from public;
grant execute on function public.save_structure_draft_v2(text, uuid, text, text, date, date, jsonb, text, timestamptz) to anon, authenticated;

create or replace function public.get_org_structure(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_org_structure(p_session_token); $$;

revoke all on function public.get_org_structure(text) from public;
grant execute on function public.get_org_structure(text) to anon, authenticated;

notify pgrst, 'reload schema';
