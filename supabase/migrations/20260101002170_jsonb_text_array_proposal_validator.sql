-- Repair continuation. The 002160 that reached production repaired the
-- template writers but not proposal_items_valid, which held the same
-- jsonb -> text[] cast on its extension allowlist and still raises 42846 on
-- the first file submission. This re-declares the validator through the
-- helper. create-or-replace throughout, so it is a no-op where the two prior
-- migrations already ran correctly.
create or replace function smartgov.jsonb_text_array(p_value jsonb)
returns text[]
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(
    (select array_agg(elem) from jsonb_array_elements_text(p_value) elem),
    '{}'::text[]
  );
$$;

revoke all on function smartgov.jsonb_text_array(jsonb) from public;

create or replace function smartgov.proposal_items_valid(
  p_account  smartgov.accounts,
  p_template jsonb,
  p_items    jsonb,
  p_version  int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_i      int;
  v_t      jsonb;
  v_tid    uuid;
  v_entry  jsonb;
  v_ext    text;
  v_name   text;
  v_path   text;
  v_link   text;
  v_size   bigint;
  v_frag   text;
  v_found  boolean;
  v_e      int;
begin
  for v_i in 0 .. jsonb_array_length(p_template) - 1 loop
    v_t    := p_template->v_i;
    v_tid  := (v_t->>'id')::uuid;
    v_found := false;

    for v_e in 0 .. jsonb_array_length(p_items) - 1 loop
      v_entry := p_items->v_e;
      if (v_entry->>'requirement_item_id')::uuid = v_tid then
        v_found := true;
        exit;
      end if;
    end loop;

    if not v_found then
      return jsonb_build_object('ok', false, 'reason', 'incomplete_submission');
    end if;

    if v_entry->>'kind' <> v_t->>'itemKind' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    if v_t->>'itemKind' = 'file' then
      v_name := v_entry->>'originalName';
      v_path := v_entry->>'storagePath';
      v_size := coalesce((v_entry->>'sizeBytes')::bigint, 0);
      if v_name is null or position('/' in v_name) > 0
         or position('\' in v_name) > 0 or length(v_name) > 128
         or v_path is null or v_size < 1 or v_size > 10485760 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
      v_ext := lower(substring(v_name from '[^.]+$'));
      if not (v_ext = any(smartgov.jsonb_text_array(v_t->'allowedExtensions'))) then
        return jsonb_build_object('ok', false, 'reason', 'unsupported_file_type');
      end if;
      v_frag := substring(v_path from 'proposals/([^/]+)/');
      if v_frag is null
         or v_path <> p_account.organization_id::text || '/proposals/'
              || v_frag || '/v' || p_version || '/'
              || v_tid || '/' || v_name then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
    else
      v_link := btrim(v_entry->>'linkUrl');
      if v_link !~ '^https?://' or length(v_link) > 2048 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.proposal_items_valid(
  smartgov.accounts, jsonb, jsonb, int) from public;