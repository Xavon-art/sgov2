-- 03030 -- The template gallery has to be able to hand the document back.
--
-- The problem this fixes: `list_structure_templates` (02960) returns only
-- metadata -- key, name, description, category, isBuiltin, and two counts -- so
-- the builder's gallery could list "Committee on Academics, 6 committees, 24
-- seats" and there was no function anywhere that returned what those committees
-- actually *were*. `import_structure_template` does not fill the gap: despite
-- the name it saves a document as a template (an upsert into
-- `gov_structure_templates`), it never returns one. A gallery with a "Use this"
-- button and nothing to apply would have been a feature that only pretended.
--
-- The fix is to include the stored `document` in the list rather than to add a
-- second session-taking function to call per template. That keeps the gallery to
-- one round trip, and it is safe to do in the list because of what a template
-- provably cannot contain: `import_structure_template` and the builtin seeding
-- both go through `gov_document_valid(doc, p_allow_holders => false)`, which
-- refuses any holder with the detail "A template cannot name people". So this
-- change cannot widen what a caller sees -- it adds committee and position keys
-- and titles to a response that already names the template, and never an
-- officer's name, email, or photo.
--
-- Same signature as before, so the `public.list_structure_templates` forwarder
-- from 02970 is untouched and keeps working.

create or replace function smartgov.list_structure_templates(p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  return jsonb_build_object(
    'ok', true,
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'key', t.key,
               'name', t.name,
               'description', t.description,
               'category', t.category,
               'isBuiltin', t.is_builtin,
               'document', t.document,
               'committees', jsonb_array_length(t.document->'committees'),
               'seats', (
                 select count(*)
                   from jsonb_array_elements(t.document->'committees') c
                   cross join lateral jsonb_array_elements(c->'positions') s
               )
             ) order by t.is_builtin desc, t.category, t.name)
        from smartgov.gov_structure_templates t
       where t.is_builtin
          or t.organization_id = v_account.organization_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_structure_templates(text) from public;