-- 04500 -- Phase 3 structure hardening.
--
-- Four independent gaps are closed here without rewriting approved history:
--
--   1. The document upgrade now mirrors `holders[0]` into `holder`, and an
--      explicit `holder: null` is treated as a vacancy rather than resurrected
--      from a stale array. Old rows are upgraded on read/save, never in bulk.
--   2. Validation catches a person seated twice anywhere in the document, and
--      measures photo bytes the same way the writer does (512 KiB), instead of
--      trusting the larger base64 string length.
--   3. Holder photos written from a draft or the dedicated photo RPC must be
--      people in the caller's downward people scope. Identical bytes are left
--      alone, so a no-op save cannot churn the roster's large object.
--   4. Realtime signals are public broadcasts on one topic per account, not
--      readable rows in a publication. The table's SELECT grant is gone, RLS is
--      on, and the client listens to the matching broadcast events.

-- ---------------------------------------------------------------- realtime

create or replace function public.sgov_broadcast_signal(
  p_account uuid,
  p_kind    text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  if p_account is null or p_kind is null then
    return;
  end if;

  -- A signalling failure must never fail the write that caused it.
  begin
    perform realtime.send(
      payload => jsonb_build_object('kind', p_kind),
      event   => p_kind,
      topic   => 'sgov-signals-' || p_account::text,
      private => false);
  exception when others then
    null;
  end;
end;
$$;

revoke all on function public.sgov_broadcast_signal(uuid, text) from public;

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
    perform public.sgov_broadcast_signal(r.account_id, 'message');
  end loop;
  return null;
end;
$$;

create or replace function public.sgov_queue_notification_events()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  perform public.sgov_broadcast_signal(NEW.account_id, 'notification');
  return null;
end;
$$;

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
    perform public.sgov_broadcast_signal(r.id, 'structure');
  end loop;
  return null;
end;
$$;

alter table public.realtime_events enable row level security;
revoke select, insert, update, delete on public.realtime_events from anon, authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'realtime_events'
  ) then
    alter publication supabase_realtime drop table public.realtime_events;
  end if;
end $$;

-- ---------------------------------------------------------- document upgrade

-- One boundary for the two holder fields. `holders` wins only when it actually
-- has entries; `holder` wins otherwise. An explicit JSON null is a deliberate
-- vacancy and clears the stale array instead of re-seating somebody.
create or replace function smartgov.gov_sync_position_holders(p_position jsonb)
returns jsonb
language sql immutable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  with synced as (
    select case
             when jsonb_typeof(p_position->'holder') = 'null' then '[]'::jsonb
             when jsonb_typeof(p_position->'holders') = 'array'
                  and jsonb_array_length(p_position->'holders') > 0
               then coalesce((
                      select jsonb_agg(smartgov.gov_holder_upgrade(h.value) order by h.ord)
                        from jsonb_array_elements(p_position->'holders')
                             with ordinality as h(value, ord)), '[]'::jsonb)
             when jsonb_typeof(p_position->'holder') = 'object'
                  and p_position->'holder' <> '{}'::jsonb
               then jsonb_build_array(smartgov.gov_holder_upgrade(p_position->'holder'))
             else '[]'::jsonb
           end as holders
  )
  select case
           when jsonb_typeof(p_position) <> 'object' then p_position
           else p_position
                || jsonb_build_object('holder', coalesce(s.holders->0, 'null'::jsonb))
                || jsonb_build_object('holders', s.holders)
         end
    from synced s;
$$;

revoke all on function smartgov.gov_sync_position_holders(jsonb) from public;

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
                        smartgov.gov_sync_position_holders(p.value)
                        || jsonb_build_object(
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
                                  else 1 end)
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

-- ---------------------------------------------------------------- validation

-- Same contract as 02960/02980/03310, with two stronger checks: a person may
-- occupy only one seat in the whole document, and a photo is measured after
-- decoding so the validator and every writer enforce the same 524288 bytes.
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
  v_seen_h     text[] := '{}';
  v_email      text;
  v_name       text;
  v_decoded    bytea;
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

  -- Pass 1: every seat key, globally.
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

      -- The same precedence as the editor: a non-empty holders array wins,
      -- otherwise the legacy single holder is the whole list.
      v_list := case
                  when jsonb_typeof(v_p->'holders') = 'array'
                       and jsonb_array_length(v_p->'holders') > 0 then v_p->'holders'
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

        -- One seat per person across the whole document, not just within a
        -- committee or within one position's co-holder list.
        if v_email = any (v_seen_h) then
          return jsonb_build_object(
            'ok', false, 'reason', 'duplicate_holder',
            'detail', format('%s is listed in more than one seat.', v_email));
        end if;
        v_seen_h := array_append(v_seen_h, v_email);

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

        if v_h ? 'photo' and coalesce(v_h->>'photo', '') <> '' then
          begin
            v_decoded := decode(v_h->>'photo', 'base64');
          exception when others then
            return jsonb_build_object(
              'ok', false, 'reason', 'invalid_request',
              'detail', format('The photo for "%s" is not valid base64.', v_title));
          end;

          if length(v_decoded) = 0 or length(v_decoded) > 524288 then
            return jsonb_build_object(
              'ok', false, 'reason', 'invalid_request',
              'detail', format('The photo for "%s" is too large.', v_title));
          end if;
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

-- Template import needs the same document checks plus one thing the document
-- cannot know: a custom key may not shadow a built-in template. A separate
-- three-argument overload keeps every existing two-argument caller intact.
create or replace function smartgov.gov_document_valid(
  p_document      jsonb,
  p_allow_holders boolean,
  p_template_key  text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_key text := lower(btrim(coalesce(p_template_key, '')));
begin
  if exists (
    select 1
      from smartgov.gov_structure_templates t
     where t.is_builtin
       and lower(btrim(t.key)) = v_key
  ) then
    return jsonb_build_object(
      'ok', false, 'reason', 'invalid_request',
      'detail', 'That key is reserved for a built-in template.');
  end if;

  return smartgov.gov_document_valid(p_document, p_allow_holders);
end;
$$;

revoke all on function smartgov.gov_document_valid(jsonb, boolean, text) from public;

-- ------------------------------------------------------------ template write

create or replace function smartgov.import_structure_template(
  p_session_token text,
  p_key           text,
  p_name          text,
  p_description   text,
  p_category      text,
  p_document      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_valid   jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner'
     and not smartgov.is_org_reviewer(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if length(btrim(coalesce(p_key, ''))) not between 2 and 60
     or length(btrim(coalesce(p_name, ''))) not between 2 and 80
     or coalesce(p_category, 'custom') not in
       ('general','academic','org','athletic','media','service','custom') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'structure:template:' || v_account.id::text, 30, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_valid := smartgov.gov_document_valid(p_document, false, btrim(p_key));
  if not (v_valid->>'ok')::boolean then
    return v_valid;
  end if;

  insert into smartgov.gov_structure_templates (
    organization_id, key, name, description, category, document, is_builtin, created_by
  ) values (
    v_account.organization_id, btrim(p_key), btrim(p_name),
    left(btrim(coalesce(p_description, '')), 300),
    coalesce(p_category, 'custom'), p_document, false, v_account.id
  )
  on conflict (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(key))
  do update set name = excluded.name,
                description = excluded.description,
                category = excluded.category,
                document = excluded.document,
                created_by = excluded.created_by,
                created_at = now();

  return jsonb_build_object(
    'ok', true, 'key', btrim(p_key), 'name', btrim(p_name));
end;
$$;

revoke all on function smartgov.import_structure_template(text, text, text, text, text, jsonb) from public;

-- ------------------------------------------------------------ photo writes

-- Reviewers may see every member; authors only their own downward people
-- scope. This is the same boundary the roster picker and photo read already
-- use, so naming an email in a document cannot widen it.
create or replace function smartgov.gov_holder_in_people_scope(
  p_account smartgov.accounts,
  p_email   text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if p_account.id is null or p_account.organization_id is null or v_email = '' then
    return false;
  end if;

  if p_account.account_scope = 'owner'
     or smartgov.is_org_reviewer(p_account.id, p_account.organization_id) then
    return true;
  end if;

  return exists (
    select 1
      from smartgov.roster r
      join smartgov.unit_memberships m
        on m.roster_id = r.id
       and m.end_date is null
     where r.organization_id = p_account.organization_id
       and lower(r.email) = v_email
       and m.unit_id = any (smartgov.gov_people_unit_ids(p_account))
  );
end;
$$;

revoke all on function smartgov.gov_holder_in_people_scope(smartgov.accounts, text) from public;

create or replace function smartgov.gov_persist_holder_photo_scoped(
  p_account smartgov.accounts,
  p_holder  jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_email    text := lower(btrim(coalesce(p_holder->>'email', '')));
  v_photo    bytea;
  v_new_oid  oid;
  v_old_oid  oid;
  v_roster   uuid;
begin
  if v_email = '' or coalesce(p_holder->>'photo', '') = '' then
    return;
  end if;

  if not smartgov.gov_holder_in_people_scope(p_account, v_email) then
    return;
  end if;

  begin
    v_photo := decode(p_holder->>'photo', 'base64');
  exception when others then
    return;
  end;

  if length(v_photo) = 0 or length(v_photo) > 524288 then
    return;
  end if;

  select r.id, r.photo_oid
    into v_roster, v_old_oid
    from smartgov.roster r
   where r.organization_id = p_account.organization_id
     and lower(r.email) = v_email;

  if v_roster is null then
    return;
  end if;

  -- Re-saving a document that already carries the stored bytes must not
  -- replace the large object or break readers holding its oid.
  begin
    if v_old_oid is not null and lo_get(v_old_oid) = v_photo then
      return;
    end if;
  exception when undefined_object then
    null;
  end;

  v_new_oid := lo_from_bytea(0, v_photo);

  if v_old_oid is not null and v_old_oid <> v_new_oid then
    begin
      perform lo_unlink(v_old_oid);
    exception when others then
      null;
    end;
  end if;

  update smartgov.roster r
     set photo_oid   = v_new_oid,
         photo_mime  = 'image/jpeg',
         photo_bytes = length(v_photo)
   where r.id = v_roster;
end;
$$;

revoke all on function smartgov.gov_persist_holder_photo_scoped(smartgov.accounts, jsonb) from public;

create or replace function smartgov.gov_persist_holder_photos_scoped(
  p_account  smartgov.accounts,
  p_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_doc jsonb;
  v_c   jsonb;
  v_p   jsonb;
  v_h   jsonb;
begin
  if jsonb_typeof(p_document) <> 'object'
     or jsonb_typeof(p_document->'committees') <> 'array' then
    return smartgov.gov_strip_photos(p_document);
  end if;

  v_doc := p_document;

  for v_c in select value from jsonb_array_elements(v_doc->'committees') loop
    if jsonb_typeof(v_c->'positions') <> 'array' then
      continue;
    end if;

    for v_p in select value from jsonb_array_elements(v_c->'positions') loop
      if jsonb_typeof(v_p->'holder') = 'object'
         and v_p->'holder' <> '{}'::jsonb
         and coalesce(v_p->'holder'->>'photo', '') <> '' then
        perform smartgov.gov_persist_holder_photo_scoped(p_account, v_p->'holder');
      end if;

      if jsonb_typeof(v_p->'holders') = 'array' then
        for v_h in select value from jsonb_array_elements(v_p->'holders') loop
          if coalesce(v_h->>'photo', '') <> '' then
            perform smartgov.gov_persist_holder_photo_scoped(p_account, v_h);
          end if;
        end loop;
      end if;
    end loop;
  end loop;

  return smartgov.gov_strip_photos(v_doc);
end;
$$;

revoke all on function smartgov.gov_persist_holder_photos_scoped(smartgov.accounts, jsonb) from public;

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

  v_document := smartgov.gov_document_upgrade(p_document);
  v_document := smartgov.gov_persist_holder_photos_scoped(v_account, v_document);

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

create or replace function smartgov.persist_structure_holder_photo(
  p_session_token uuid,
  p_unit_id       uuid,
  p_email         text,
  p_photo         text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_access   jsonb;
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_photo    bytea;
  v_hex      text;
  v_mime     text := 'image/jpeg';
  v_roster   uuid;
begin
  select a.* into v_account
    from smartgov.sessions s
    join smartgov.accounts a on a.id = s.account_id
   where s.id = p_session_token
     and s.expires_at > now()
     and a.status = 'active';

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null or p_unit_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);
  if not (v_access->>'canEdit')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_email = '' or coalesce(p_photo, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.gov_holder_in_people_scope(v_account, v_email) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  begin
    v_photo := decode(p_photo, 'base64');
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end;

  if length(v_photo) = 0 or length(v_photo) > 524288 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select r.id into v_roster
    from smartgov.roster r
   where r.organization_id = v_account.organization_id
     and lower(r.email) = v_email;

  if v_roster is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform smartgov.gov_persist_holder_photo_scoped(
    v_account,
    jsonb_build_object('email', v_email, 'photo', p_photo));

  v_hex := encode(v_photo, 'hex');
  if starts_with(v_hex, '89504e47') then
    v_mime := 'image/png';
  elsif starts_with(v_hex, '52494646') then
    v_mime := 'image/webp';
  end if;

  update smartgov.roster r
     set photo_mime = v_mime
   where r.id = v_roster;

  return jsonb_build_object(
    'ok', true,
    'hasPhoto', true,
    'rosterId', v_roster);
end;
$$;

revoke all on function smartgov.persist_structure_holder_photo(uuid, uuid, text, text) from public;

-- --------------------------------------------------------------- write: submit

create or replace function smartgov.submit_structure(
  p_session_token text,
  p_structure_id  uuid,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_access   jsonb;
  v_struct   smartgov.gov_structures%rowtype;
  v_valid    jsonb;
  v_root     uuid;
  v_decision jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_struct
    from smartgov.gov_structures s
   where s.id = p_structure_id
     and s.organization_id = v_account.organization_id
   for update;

  if v_struct.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_access := smartgov.gov_unit_access(v_account, v_struct.unit_id);
  if not (v_access->>'canEdit')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_struct.status not in ('draft','returned') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'structure:submit:' || v_account.id::text, 20, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_valid := smartgov.gov_document_valid(v_struct.document);
  if not (v_valid->>'ok')::boolean then
    return v_valid;
  end if;

  update smartgov.gov_structures s
     set status = 'submitted',
         submitted_by = v_account.id,
         submitted_at = now(),
         -- An omitted note means "keep the draft's note", not "erase it".
         note = coalesce(
                  nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
                  s.note),
         updated_at = now()
   where s.id = v_struct.id
   returning * into v_struct;

  v_root := smartgov.gov_root_unit(v_account.organization_id);

  if v_struct.unit_id = v_root then
    v_decision := smartgov.gov_record_decision(v_struct, v_account.id, 'approved', null);
    if not (v_decision->>'ok')::boolean then
      update smartgov.gov_structures
         set status = 'draft',
             submitted_at = null,
             updated_at = now()
       where id = v_struct.id
         and status = 'submitted';
      return v_decision;
    end if;
    return v_decision || jsonb_build_object('autoApproved', true);
  end if;

  return jsonb_build_object(
    'ok', true, 'structureId', v_struct.id, 'status', 'submitted',
    'revision', v_struct.revision, 'autoApproved', false);
end;
$$;

revoke all on function smartgov.submit_structure(text, uuid, text) from public;

-- -------------------------------------------------------------- write: renew

create or replace function smartgov.request_structure_renewal(
  p_session_token text,
  p_unit_id       uuid,
  p_term_label    text,
  p_starts_on     date,
  p_ends_on       date
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_access   jsonb;
  v_live     smartgov.gov_structures%rowtype;
  v_open     uuid;
  v_starts   date;
  v_ends     date;
  v_label    text;
  v_document jsonb;
  v_new      smartgov.gov_structures%rowtype;
  v_root     uuid;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);
  if not (v_access->>'canEdit')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not smartgov.consume_rate_limit(
       'structure:renew:' || v_account.id::text, 20, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select * into v_live
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status = 'approved';

  if v_live.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_approved_structure');
  end if;

  select s.id into v_open
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status in ('draft','submitted','returned');

  if v_open is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_in_progress');
  end if;

  v_starts := coalesce(p_starts_on, v_live.ends_on + 1);
  v_ends   := coalesce(p_ends_on, (v_starts::timestamp + interval '1 year')::date);
  v_label  := coalesce(nullif(btrim(coalesce(p_term_label, '')), ''), v_live.term_label);

  if v_ends <= v_starts or length(v_label) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_root := smartgov.gov_root_unit(v_account.organization_id);

  -- Hydrate the copy, not the approved row: the new draft needs the current
  -- holder array and roster-backed photo flags before the editor sees it.
  v_document := smartgov.gov_mark_existing_photos(
    v_account.organization_id,
    smartgov.gov_document_upgrade(v_live.document));

  insert into smartgov.gov_structures (
    organization_id, unit_id, author_kind, created_by,
    term_label, starts_on, ends_on, status, document, note, renews_id
  ) values (
    v_account.organization_id, p_unit_id,
    case when p_unit_id = v_root then 'usg' else 'lsg' end,
    v_account.id,
    v_label, v_starts, v_ends, 'draft', v_document,
    'Renewal of ' || v_live.term_label,
    v_live.id
  ) returning * into v_new;

  return jsonb_build_object(
    'ok', true,
    'structureId', v_new.id,
    'termLabel', v_new.term_label,
    'startsOn', v_new.starts_on,
    'endsOn', v_new.ends_on,
    'renewsId', v_new.renews_id,
    'status', v_new.status
  );
end;
$$;

revoke all on function smartgov.request_structure_renewal(text, uuid, text, date, date) from public;

notify pgrst, 'reload schema';
