-- Download gate for a task requirement answer document.

create or replace function smartgov.get_task_requirement_file(
  p_session_token text,
  p_requirement_id uuid,
  p_unit_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_req smartgov.task_requirements%rowtype;
  v_task smartgov.tasks%rowtype;
  v_sub smartgov.task_requirement_submissions%rowtype;
  v_usg boolean;
  v_units uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select rq.* into v_req from smartgov.task_requirements rq where rq.id = p_requirement_id;
  if v_req.id is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  select t.* into v_task from smartgov.tasks t where t.id = v_req.task_id and t.organization_id = v_account.organization_id;
  if v_task.id is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);
  select coalesce(array_agg(u),'{}'::uuid[]) into v_units from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;
  if not v_usg and not (p_unit_id = any (v_units)) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select s.* into v_sub from smartgov.task_requirement_submissions s
    where s.requirement_id = p_requirement_id and s.unit_id = p_unit_id;
  if v_sub.storage_path is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  return jsonb_build_object(
    'ok', true,
    'storagePath', v_sub.storage_path,
    'originalName', v_sub.original_name,
    'mimeType', v_sub.mime_type,
    'sizeBytes', v_sub.size_bytes,
    'largeObjectOid', (select du.large_object_oid from smartgov.document_uploads du where du.storage_path = v_sub.storage_path limit 1)
  );
end;
$$;

create or replace function public.get_task_requirement_file(p_session_token text, p_requirement_id uuid, p_unit_id uuid)
returns jsonb language sql security definer as $$ select smartgov.get_task_requirement_file($1,$2,$3); $$;

grant execute on function public.get_task_requirement_file(text,uuid,uuid) to anon, authenticated;