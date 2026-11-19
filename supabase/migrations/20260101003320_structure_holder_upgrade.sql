-- Upgrade pass 2: co-holders get the same derived `fullName` as the primary
-- holder, and every seat carries a `holders` array (empty when vacant) so the
-- renderer and the inspector never need two code paths.

create or replace function smartgov.gov_holder_upgrade(p_holder jsonb)
returns jsonb
language sql immutable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select case
           when jsonb_typeof(p_holder) <> 'object' or p_holder = '{}'::jsonb
             then p_holder
           when coalesce(p_holder->>'fullName', '') = ''
             and btrim(concat_ws(' ',
                         coalesce(p_holder->>'firstName', ''),
                         coalesce(p_holder->>'middleName', ''),
                         coalesce(p_holder->>'lastName', ''))) <> ''
             then p_holder || jsonb_build_object(
                    'fullName',
                    btrim(concat_ws(' ',
                            coalesce(p_holder->>'firstName', ''),
                            coalesce(p_holder->>'middleName', ''),
                            coalesce(p_holder->>'lastName', ''))))
           else p_holder
         end;
$$;

revoke all on function smartgov.gov_holder_upgrade(jsonb) from public;

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
                             when x.holder is not null
                              and jsonb_typeof(x.holder) = 'object'
                              and x.holder <> '{}'::jsonb
                             then jsonb_build_object('holder', x.holder)
                             else '{}'::jsonb
                           end
                        || jsonb_build_object('holders', y.holders)
                        order by p.ord)
                 from jsonb_array_elements(
                        case when jsonb_typeof(c.committee->'positions') = 'array'
                             then c.committee->'positions' else '[]'::jsonb end)
                      with ordinality as p(value, ord)
                 cross join lateral (
                   select smartgov.gov_holder_upgrade(p.value->'holder') as holder
                 ) x
                 cross join lateral (
                   select case
                            when jsonb_typeof(p.value->'holders') = 'array'
                              then coalesce((
                                     select jsonb_agg(
                                              smartgov.gov_holder_upgrade(h.value)
                                              order by h.ord)
                                       from jsonb_array_elements(p.value->'holders')
                                            with ordinality as h(value, ord)
                                   ), '[]'::jsonb)
                            when x.holder is not null
                             and jsonb_typeof(x.holder) = 'object'
                             and x.holder <> '{}'::jsonb
                              then jsonb_build_array(x.holder)
                            else '[]'::jsonb
                          end as holders
                 ) y
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

notify pgrst, 'reload schema';
