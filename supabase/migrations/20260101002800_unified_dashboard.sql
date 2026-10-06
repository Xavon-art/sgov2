-- ------------------------------------------------------- 02800: the unified dashboard
--
-- Every module that arrived so far grew its own list: programs and proposals in
-- 02000, budgets in 02300, tasks in 02400, documents and their rulings in 02600/02700.
-- Each one answers "what is in my module". None of them answers the only question a
-- person actually walks in with, which is "what is waiting for me, and what did
-- somebody decide about me while I was away".
--
-- So this is one read that spans all of them, and it is one read rather than six
-- because six requests would each re-derive the same scope and could disagree. The
-- scope is not new: it is the union of the scopes `list_proposals`, `list_budgets`,
-- and `list_tasks` already use, copied here deliberately so that a dashboard can
-- never show a row whose own screen would refuse to open it. If one of those three
-- changes its rule, this has to change with it -- that is the cost of one query, and
-- it is cheaper than a dashboard that lies.
--
-- The other thing worth stating: the payload carries ids and states, never links.
-- `/lsg/proposals` and `/usg/proposals` are different routes for different people, and
-- a database function that knew that would be a routing decision hiding in a
-- security-definer function. The caller maps `kind` to a route; see
-- `src/components/dashboard/DashboardView.tsx`.
--
-- `canReview` is returned rather than derived in the browser because the two
-- dashboards it gates are different screens: the officer sees a list of documents
-- nobody has ruled on yet, the reviewer sees the buttons to rule on them.

create or replace function smartgov.list_dashboard(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_is_usg    boolean;
  v_units     uuid[] := '{}'::uuid[];
  v_proposals uuid[] := '{}'::uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
              or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[])
    into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  -- The proposal set every section below is cut to. Materialised once so the scope
  -- is written down a single time: the four counts, the three queues, and the
  -- timeline all read this array rather than each repeating the predicate.
  select coalesce(array_agg(p.id), '{}'::uuid[])
    into v_proposals
    from smartgov.proposals p
   where p.organization_id = v_account.organization_id
     and (
       v_is_usg
       or p.created_by = v_account.id
       or (p.unit_id is not null and p.unit_id = any (v_units))
     );

  return jsonb_build_object(
    'ok', true,
    'scope', case when v_is_usg then 'organization' else 'unit' end,
    'canReview', v_is_usg,

    'counts', jsonb_build_object(

      'proposals', jsonb_build_object(
        'visible', coalesce(array_length(v_proposals, 1), 0),
        'awaitingReview', (select count(*)::int from smartgov.proposals p
                            where p.id = any (v_proposals)
                              and p.status in ('submitted', 'returned')),
        'returnedToMe', (select count(*)::int from smartgov.proposals p
                           where p.id = any (v_proposals)
                             and p.status = 'returned'
                             and p.created_by = v_account.id),
        'mineOpen', (select count(*)::int from smartgov.proposals p
                      where p.id = any (v_proposals)
                        and p.created_by = v_account.id
                        and p.status in ('submitted', 'returned'))
      ),

      -- "awaiting check" is the absence of a ruling, not the presence of a file, so
      -- the same row counts for an officer (nobody has looked at it) and for a
      -- reviewer (nobody on their side has looked at it). `mineUnchecked` is the
      -- reviewer's own backlog and is the only one of the three that means work.
      'documents', (
        select jsonb_build_object(
          'total', count(*),
          'awaitingCheck', count(*) filter (where sv.verdict is null),
          'queried', count(*) filter (where sv.verdict = 'queried'),
          'rejected', count(*) filter (where sv.verdict = 'rejected'),
          'mineUnchecked', count(*) filter (where mine.verdict is null)
        )
          from smartgov.item_submissions isub
          join smartgov.proposal_versions pv on pv.id = isub.version_id
          left join lateral (
            select v.verdict
              from smartgov.submission_verifications v
             where v.submission_id = isub.id
             order by v.created_at desc, v.verified_by desc
             limit 1
          ) sv on true
          left join lateral (
            select v.verdict
              from smartgov.submission_verifications v
             where v.submission_id = isub.id
               and v.verified_by = v_account.id
             limit 1
          ) mine on true
         where pv.proposal_id = any (v_proposals)
           and isub.submission_kind = 'file'
      ),

      'budgets', (
        select jsonb_build_object(
          'visible', count(*),
          'awaitingDecision', count(*) filter (where b.status = 'submitted'),
          'mineOpen', count(*) filter (where b.requested_by = v_account.id
                                         and b.status in ('submitted', 'returned'))
        )
          from smartgov.budget_requests b
         where b.organization_id = v_account.organization_id
           and (
             v_is_usg
             or b.requested_by = v_account.id
             or (b.unit_id is not null and b.unit_id = any (v_units))
           )
      ),

      -- `overdue` is derived here for the same reason `list_tasks` derives it: a
      -- deadline is a date and a status, and only the pair in hand can say whether
      -- it has passed. Storing it would need a nightly job to be honest.
      'tasks', (
        select jsonb_build_object(
          'visible', count(*),
          'overdue', count(*) filter (
            where t.due_date is not null
              and t.due_date < current_date
              and coalesce((select min(ta.status) from smartgov.task_assignments ta
                             where ta.task_id = t.id), '') <> 'done'),
          'awaitingMe', count(*) filter (
            where exists (select 1 from smartgov.task_assignments ta
                           where ta.task_id = t.id
                             and ta.status <> 'done'
                             and (v_is_usg or ta.unit_id = any (v_units))))
        )
          from smartgov.tasks t
         where t.organization_id = v_account.organization_id
           and (v_is_usg or exists (
                 select 1 from smartgov.task_assignments ta
                  where ta.task_id = t.id
                    and ta.unit_id = any (v_units)))
      )
    ),

    -- The newest few of each, not all of them. A dashboard that renders nine
    -- hundred rows is a list screen wearing a dashboard's clothes, and the list
    -- screens already exist.
    'proposals', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', p.id,
          'title', p.title,
          'status', p.status,
          'activityType', p.activity_type,
          'unitName', (select gu.name from public.governance_units gu where gu.id = p.unit_id),
          'version', (select max(pv.version_number) from smartgov.proposal_versions pv
                       where pv.proposal_id = p.id),
          'createdAt', p.created_at,
          'mine', p.created_by = v_account.id,
          -- "waiting on me" is the union of the two reasons a row stops: an officer
          -- has a returned proposal to fix, a reviewer has one to decide.
          'awaitingMe', (p.status = 'returned' and p.created_by = v_account.id)
                     or (p.status in ('submitted', 'returned') and v_is_usg)
        ) as q
          from smartgov.proposals p
         where p.id = any (v_proposals)
         order by p.created_at desc
         limit 8
      ) q
    ),

    -- `attached` repeats the completeness test from 02700 rather than trusting that
    -- a file submission means a file arrived. A dashboard that claimed a document
    -- was attached when the bytes did not land would be the worst bug in the app.
    'documents', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select jsonb_build_object(
          'submissionId', isub.id,
          'proposalId', pv.proposal_id,
          'proposalTitle', pr.title,
          'label', ri.label,
          'originalName', isub.original_name,
          'attached', exists (select 1 from smartgov.document_uploads d
                               where d.storage_path = isub.storage_path
                                 and d.large_object_oid is not null
                                 and d.confirmed_at is not null
                                 and d.written_bytes = d.size_bytes),
          'verdict', sv.verdict,
          'verifiedBy', (select a.display_name from smartgov.accounts a where a.id = sv.verified_by),
          'verifiedAt', sv.created_at,
          'myVerdict', mine.verdict
        ) as q
          from smartgov.item_submissions isub
          join smartgov.proposal_versions pv on pv.id = isub.version_id
          join smartgov.proposals pr on pr.id = pv.proposal_id
          join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
          left join lateral (
            select v.verdict, v.verified_by, v.created_at
              from smartgov.submission_verifications v
             where v.submission_id = isub.id
             order by v.created_at desc, v.verified_by desc
             limit 1
          ) sv on true
          left join lateral (
            select v.verdict
              from smartgov.submission_verifications v
             where v.submission_id = isub.id
               and v.verified_by = v_account.id
             limit 1
          ) mine on true
         where pv.proposal_id = any (v_proposals)
           and isub.submission_kind = 'file'
         order by isub.submitted_at desc
         limit 8
      ) q
    ),

    'budgets', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', b.id,
          'proposalId', b.proposal_id,
          'title', b.title,
          'status', b.status,
          'unitName', (select gu.name from public.governance_units gu where gu.id = b.unit_id),
          'requestedTotal', b.requested_total,
          'approvedTotal', b.approved_total,
          'createdAt', b.created_at,
          'mine', b.requested_by = v_account.id,
          'awaitingMe', b.status = 'submitted' and v_is_usg
        ) as q
          from smartgov.budget_requests b
         where b.organization_id = v_account.organization_id
           and (
             v_is_usg
             or b.requested_by = v_account.id
             or (b.unit_id is not null and b.unit_id = any (v_units))
           )
         order by b.created_at desc
         limit 6
      ) q
    ),

    'tasks', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', t.id,
          'title', t.title,
          'priority', t.priority,
          'dueDate', t.due_date,
          'overdue', (t.due_date is not null
                      and t.due_date < current_date
                      and coalesce((select min(ta.status) from smartgov.task_assignments ta
                                     where ta.task_id = t.id), '') <> 'done'),
          'doneUnits', (select count(*) from smartgov.task_assignments ta
                         where ta.task_id = t.id and ta.status = 'done'),
          'totalUnits', (select count(*) from smartgov.task_assignments ta
                          where ta.task_id = t.id),
          'mineStatus', (select ta.status from smartgov.task_assignments ta
                          where ta.task_id = t.id
                            and ta.unit_id = any (v_units)
                          limit 1),
          'awaitingMe', exists (select 1 from smartgov.task_assignments ta
                                 where ta.task_id = t.id
                                   and ta.status <> 'done'
                                   and (v_is_usg or ta.unit_id = any (v_units)))
        ) as q
          from smartgov.tasks t
         where t.organization_id = v_account.organization_id
           and (v_is_usg or exists (
                 select 1 from smartgov.task_assignments ta
                  where ta.task_id = t.id
                    and ta.unit_id = any (v_units)))
         order by t.due_date nulls last, t.created_at desc
         limit 6
      ) q
    ),

    -- What happened, newest first. Six sources unioned, each already scoped, and no
    -- new table: a decision is a row that already had to exist for the module screen
    -- to mean anything. The `kind` is what the caller turns into a route.
    'timeline', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select e.* from (
          select pv.submitted_at as at,
                 'proposal'::text as kind,
                 pr.id as proposal_id,
                 null::uuid as budget_id,
                 null::uuid as task_id,
                 pr.title as title,
                 'Submitted version ' || pv.version_number::text as detail,
                 (select a.display_name from smartgov.accounts a where a.id = pv.submitted_by) as actor
            from smartgov.proposal_versions pv
            join smartgov.proposals pr on pr.id = pv.proposal_id
           where pv.proposal_id = any (v_proposals)
          union all
          select r.created_at,
                 'decision',
                 r.proposal_id,
                 null::uuid,
                 null::uuid,
                 pr.title,
                 'Proposal ' || r.decision,
                 (select a.display_name from smartgov.accounts a where a.id = r.decided_by)
            from smartgov.reviews r
            join smartgov.proposals pr on pr.id = r.proposal_id
           where r.proposal_id = any (v_proposals)
          union all
          select v.created_at,
                 'document',
                 pv.proposal_id,
                 null::uuid,
                 null::uuid,
                 pr.title,
                 ri.label || ' marked ' || v.verdict,
                 (select a.display_name from smartgov.accounts a where a.id = v.verified_by)
            from smartgov.submission_verifications v
            join smartgov.item_submissions isub on isub.id = v.submission_id
            join smartgov.proposal_versions pv on pv.id = isub.version_id
            join smartgov.proposals pr on pr.id = pv.proposal_id
            join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
           where pv.proposal_id = any (v_proposals)
          union all
          select b.created_at,
                 'budget',
                 b.proposal_id,
                 b.id,
                 null::uuid,
                 b.title,
                 'Budget ' || b.status,
                 (select a.display_name from smartgov.accounts a where a.id = b.requested_by)
            from smartgov.budget_requests b
           where b.organization_id = v_account.organization_id
             and (
               v_is_usg
               or b.requested_by = v_account.id
               or (b.unit_id is not null and b.unit_id = any (v_units))
             )
          union all
          select t.created_at,
                 'task',
                 null::uuid,
                 null::uuid,
                 t.id,
                 t.title,
                 'Task assigned',
                 (select a.display_name from smartgov.accounts a where a.id = t.created_by)
            from smartgov.tasks t
           where t.organization_id = v_account.organization_id
             and (v_is_usg or exists (
                   select 1 from smartgov.task_assignments ta
                    where ta.task_id = t.id
                      and ta.unit_id = any (v_units)))
          union all
          select ta.updated_at,
                 'task',
                 null::uuid,
                 null::uuid,
                 t.id,
                 t.title,
                 'Unit work ' || ta.status,
                 (select a.display_name from smartgov.accounts a where a.id = ta.updated_by)
            from smartgov.task_assignments ta
            join smartgov.tasks t on t.id = ta.task_id
           where t.organization_id = v_account.organization_id
             and (v_is_usg or ta.unit_id = any (v_units))
        ) e
        order by e.at desc, e.kind desc
        limit 12
      ) q
    )
  );
end;
$$;

revoke all on function smartgov.list_dashboard(text) from public;

-- ------------------------------------------------------------- public forwarder

create or replace function public.list_dashboard(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_dashboard($1); $$;
revoke all on function public.list_dashboard(text) from public;
grant execute on function public.list_dashboard(text) to anon, authenticated;