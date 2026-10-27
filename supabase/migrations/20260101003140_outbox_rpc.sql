-- 03140 -- Outbox RPCs for dev email capture.

create or replace function smartgov.create_outbox_entry(
  p_to text,
  p_subject text,
  p_html text,
  p_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into smartgov.outbox (to_address, subject, html, text_body)
  values (p_to, p_subject, p_html, p_text)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function smartgov.create_outbox_entry(text, text, text, text) from public;

create or replace function smartgov.list_outbox(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  return jsonb_build_object(
    'ok', true,
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'to', o.to_address,
          'subject', o.subject,
          'html', o.html,
          'text', o.text_body,
          'createdAt', o.created_at
        ) order by o.created_at desc
      )
      from smartgov.outbox o
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_outbox(integer) from public;

create or replace function public.create_outbox_entry(p_to text, p_subject text, p_html text, p_text text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_outbox_entry(p_to, p_subject, p_html, p_text); $$;
revoke all on function public.create_outbox_entry(text, text, text, text) from public;
grant execute on function public.create_outbox_entry(text, text, text, text) to anon, authenticated;

create or replace function public.list_outbox(p_limit integer)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_outbox(p_limit); $$;
revoke all on function public.list_outbox(integer) from public;
grant execute on function public.list_outbox(integer) to anon, authenticated;