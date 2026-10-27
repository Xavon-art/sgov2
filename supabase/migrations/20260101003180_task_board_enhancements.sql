-- Task board enhancements: requirement constraints (max size, rules, template),
-- extension requests, and answer version history.

alter table smartgov.task_requirements
  add column if not exists max_size_bytes bigint,
  add column if not exists rules text,
  add column if not exists template_file jsonb;

create table if not exists smartgov.task_extensions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references smartgov.tasks(id) on delete cascade,
  unit_id uuid not null references public.governance_units(id) on delete cascade,
  requested_by uuid not null references smartgov.accounts(id),
  requested_days integer not null check (requested_days between 1 and 30),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','granted','denied')),
  decided_by uuid references smartgov.accounts(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create table if not exists smartgov.task_requirement_answer_versions (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references smartgov.task_requirements(id) on delete cascade,
  unit_id uuid not null references public.governance_units(id) on delete cascade,
  version integer not null,
  link_url text,
  storage_path text,
  original_name text,
  mime_type text,
  size_bytes bigint,
  review_status text,
  review_note text,
  responded_at timestamptz not null default now(),
  unique (requirement_id, unit_id, version)
);

-- Extension request RPC
create or replace function smartgov.request_task_extension(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid,
  p_days integer,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_units uuid[];
  v_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select coalesce(array_agg(u),'{}'::uuid[]) into v_units from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;
  if not (p_unit_id = any (v_units)) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_days < 1 or p_days > 30 then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  insert into smartgov.task_extensions (task_id, unit_id, requested_by, requested_days, reason)
  values (p_task_id, p_unit_id, v_account.id, p_days, btrim(p_reason)) returning id into v_id;
  return jsonb_build_object('ok',true,'extensionId',v_id);
end;
$$;

create or replace function smartgov.decide_task_extension(
  p_session_token text,
  p_extension_id uuid,
  p_decision text,
  p_note text
) returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_ext smartgov.task_extensions%rowtype;
  v_dec text := lower(trim(coalesce(p_decision,'')));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  if not smartgov.is_usg(v_account.id, v_account.organization_id) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select * into v_ext from smartgov.task_extensions where id = p_extension_id;
  if v_ext.id is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if v_dec not in ('granted','denied') then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  update smartgov.task_extensions
    set status = v_dec, decided_by = v_account.id, decided_at = now(), decision_note = btrim(coalesce(p_note,''))
    where id = p_extension_id;
  -- If granted, extend the task due date for that unit's assignment? Task-level due date shared; extend task due date.
  if v_dec = 'granted' then
    update smartgov.tasks
      set due_date = (coalesce(due_date, current_date) + (select requested_days from smartgov.task_extensions where id = p_extension_id) * interval '1 day')::date
      where id = v_ext.task_id;
  end if;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function smartgov.list_task_extensions(
  p_session_token text,
  p_task_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  return jsonb_build_object('ok',true,'extensions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'taskId', e.task_id, 'unitId', e.unit_id,
      'unitName', (select gu.name from public.governance_units gu where gu.id = e.unit_id),
      'requestedDays', e.requested_days, 'reason', e.reason, 'status', e.status,
      'decisionNote', e.decision_note, 'createdAt', e.created_at
    ) order by e.created_at desc)
    from smartgov.task_extensions e
    where e.task_id = p_task_id and e.task_id in (
      select t.id from smartgov.tasks t where t.organization_id = v_account.organization_id
    )
  ), '[]'::jsonb));
end;
$$;

-- Answer version snapshot trigger: before upsert on task_requirement_submissions,
-- snapshot the previous row into versions.
create or replace function smartgov.snapshot_requirement_answer()
returns trigger
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_version integer;
begin
  if TG_OP = 'UPDATE' then
    select coalesce(max(version),0)+1 into v_version
      from smartgov.task_requirement_answer_versions
     where requirement_id = OLD.requirement_id and unit_id = OLD.unit_id;
    insert into smartgov.task_requirement_answer_versions
      (requirement_id, unit_id, version, link_url, storage_path, original_name, mime_type, size_bytes, review_status, review_note, responded_at)
    values
      (OLD.requirement_id, OLD.unit_id, v_version, OLD.link_url, OLD.storage_path, OLD.original_name, OLD.mime_type, OLD.size_bytes, OLD.review_status, OLD.review_note, OLD.responded_at);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_snapshot_requirement_answer on smartgov.task_requirement_submissions;
create trigger trg_snapshot_requirement_answer
  before update on smartgov.task_requirement_submissions
  for each row execute function smartgov.snapshot_requirement_answer();

-- Public wrappers
create or replace function public.request_task_extension(p_session_token text, p_task_id uuid, p_unit_id uuid, p_days integer, p_reason text)
returns jsonb language sql security definer as $$ select smartgov.request_task_extension($1,$2,$3,$4,$5); $$;
create or replace function public.decide_task_extension(p_session_token text, p_extension_id uuid, p_decision text, p_note text)
returns jsonb language sql security definer as $$ select smartgov.decide_task_extension($1,$2,$3,$4); $$;
create or replace function public.list_task_extensions(p_session_token text, p_task_id uuid)
returns jsonb language sql security definer as $$ select smartgov.list_task_extensions($1,$2); $$;
create or replace function public.list_requirement_answer_versions(p_session_token text, p_requirement_id uuid, p_unit_id uuid)
returns jsonb language sql security definer
as $$
  select jsonb_build_object('ok', true, 'versions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'version', v.version, 'linkUrl', v.link_url, 'storagePath', v.storage_path,
      'originalName', v.original_name, 'mimeType', v.mime_type, 'sizeBytes', v.size_bytes,
      'reviewStatus', v.review_status, 'reviewNote', v.review_note, 'respondedAt', v.responded_at
    ) order by v.version desc)
    from smartgov.task_requirement_answer_versions v
    where v.requirement_id = p_requirement_id and (p_unit_id is null or v.unit_id = p_unit_id)
  ), '[]'::jsonb));
$$;

grant execute on function public.request_task_extension(text,uuid,uuid,integer,text) to anon, authenticated;
grant execute on function public.decide_task_extension(text,uuid,text,text) to anon, authenticated;
grant execute on function public.list_task_extensions(text,uuid) to anon, authenticated;
grant execute on function public.list_requirement_answer_versions(text,uuid,uuid) to anon, authenticated;