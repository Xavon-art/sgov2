-- 03000 -- government structure: mark a holder's photo without flattening the seat.
--
-- `gov_mark_existing_photos` built each output position as
--
--     p.value->'holder' || jsonb_build_object('hasPhoto', ...)
--
-- which is the holder's fields *as* the position. Every filled seat therefore came
-- back with its `key` and `title` gone and its member details sitting where the
-- seat was, so a fetched structure could not be edited again -- the builder would
-- save a document whose seats had no identity and no titles.
--
-- The intent, and what this replaces it with, is the holder with one flag added:
-- `jsonb_set(p.value, '{holder}', p.value->'holder' || jsonb_build_object(...))`.
--
-- The flag is nested under `holder` rather than hoisted to the seat on purpose: it
-- describes the person, the person has at most one photo, and a client that wants
-- to show it knows to look where the photo was when it uploaded it.

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
                                    case when jsonb_typeof(p.value->'holder') = 'object'
                                         then jsonb_set(
                                                p.value, '{holder}',
                                                p.value->'holder' || jsonb_build_object(
                                                  'hasPhoto',
                                                  exists (
                                                    select 1
                                                      from smartgov.roster r
                                                     where r.organization_id = p_organization
                                                       and lower(r.email) = lower(
                                                             btrim(coalesce(p.value->'holder'->>'email', '')))
                                                       and r.photo_oid is not null
                                                  )
                                                ))
                                         else p.value
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