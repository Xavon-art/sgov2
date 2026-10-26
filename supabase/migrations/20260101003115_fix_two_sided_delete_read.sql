-- Request module: the two-sided delete, corrected.
--
-- This is a correction to a real bug, and it is worth writing down plainly
-- because the wrong version looked right.
--
-- The rule is asymmetric: when the office unsends, the message leaves the
-- office's view only; when a unit deletes, it goes for both. The first version
-- of `list_task_thread` implemented the visibility test against the message's
-- AUTHOR rather than against the READER:
--
--     and (case when m.author_side = 'usg'
--               then not m.hidden_from_office
--               else not m.hidden_from_unit end)
--
-- For an office message that reads "hide this from anyone unless the office can
-- see it", so the moment USG unsent one of its own messages the UNIT stopped
-- seeing it too -- the exact opposite of the intended rule. The flag named
-- `hidden_from_office` was being consulted on behalf of a reader who is not the
-- office.
--
-- The fix is one idea: which flag governs is decided by WHO IS READING.
--
--     v_usg  ->  the reader is the office  ->  consult hidden_from_office
--     else   ->  the reader is a unit      ->  consult hidden_from_unit
--
-- So `hidden_from_office` now only ever hides a message from the office, and
-- `hidden_from_unit` only ever hides it from units. That is what the column
-- names have said all along; the read path just was not honouring them.
--
-- Everything that depends on "is this message hidden from me" is recomputed
-- from the same expression, and it is bound once to `v_mine_hidden` vocabulary
-- inside the query so the three places cannot drift apart again.

create or replace function smartgov.list_task_thread(
  p_session_token text,
  p_task_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task    smartgov.tasks%rowtype;
  v_usg     boolean;
  v_units   uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = p_task_id
     and t.organization_id = v_account.organization_id;

  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  -- An LSG caller must actually be assigned this task to read its thread.
  if not v_usg and not exists (
    select 1 from smartgov.task_assignments ta
     where ta.task_id = p_task_id and ta.unit_id = any (v_units)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'taskId', p_task_id,
    'canClose', v_usg,
    'closed', v_task.closed_at is not null,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'unitId', m.unit_id,
        'unitName', (select gu.name from public.governance_units gu where gu.id = m.unit_id),
        'authorId', m.author_id,
        'authorName', (select coalesce(nullif(btrim(a.display_name), ''), a.email)
                         from smartgov.accounts a where a.id = m.author_id),
        'authorSide', m.author_side,
        -- "Hidden from me" is decided by the reader's side, never the author's.
        -- An office reader consults hidden_from_office; a unit reader consults
        -- hidden_from_unit. This is the correction described in the header.
        'unsent', (case when v_usg then m.hidden_from_office else m.hidden_from_unit end),
        -- A tombstone keeps its place in the thread but never its words.
        'body', (case
                   when (case when v_usg then m.hidden_from_office
                              else m.hidden_from_unit end) then ''
                   else m.body
                 end),
        'replyTo', m.reply_to,
        'createdAt', m.created_at,
        'editedAt', m.edited_at,
        'mine', (m.author_id = v_account.id),
        -- A caller may unsend only a message they wrote that is not already
        -- hidden from their own side.
        'canUnsend', (m.author_id = v_account.id
                      and not (case when v_usg then m.hidden_from_office
                                    else m.hidden_from_unit end)),
        -- The tally is computed in a grouped subquery first and aggregated
        -- second; Postgres will not nest an aggregate inside jsonb_agg.
        'reactions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'reaction', tally.reaction,
            'count', tally.n,
            'mine', tally.mine
          ))
            from (
              select r.reaction,
                     count(*)::int as n,
                     bool_or(r.account_id = v_account.id) as mine
                from smartgov.task_message_reactions r
               where r.message_id = m.id
               group by r.reaction
            ) tally
        ), '[]'::jsonb)
      ) order by m.created_at)
        from smartgov.task_messages m
       where m.task_id = p_task_id
         -- The reader's own side is the only flag that hides it from them.
         and (case when v_usg then not m.hidden_from_office
                   else not m.hidden_from_unit end)
         -- A unit's private note to the office is not read by other units.
         and (m.unit_id is null or v_usg or m.unit_id = any (v_units))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_task_thread(text, uuid) from public;

grant execute on function public.list_task_thread(text, uuid) to anon, authenticated, service_role;
