-- Name parts must join on a single space: `concat_ws` keeps empty strings, so
-- a missing middle name used to produce "Paula  Reyes".

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
                         nullif(coalesce(p_holder->>'firstName', ''), ''),
                         nullif(coalesce(p_holder->>'middleName', ''), ''),
                         nullif(coalesce(p_holder->>'lastName', ''), ''))) <> ''
             then p_holder || jsonb_build_object(
                    'fullName',
                    btrim(concat_ws(' ',
                            nullif(coalesce(p_holder->>'firstName', ''), ''),
                            nullif(coalesce(p_holder->>'middleName', ''), ''),
                            nullif(coalesce(p_holder->>'lastName', ''), ''))))
           else p_holder
         end;
$$;

revoke all on function smartgov.gov_holder_upgrade(jsonb) from public;

notify pgrst, 'reload schema';
