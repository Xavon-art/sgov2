-- 04300 -- Expose notification deletion to PostgREST.
--
-- The implementation stays in smartgov.delete_notification, but PostgREST only
-- resolves functions in the public schema. This forwarder mirrors the existing
-- notification forwarders so the delete button can reach the owner-scoped RPC.

create or replace function public.delete_notification(
  p_session_token text,
  p_notification_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.delete_notification(p_session_token, p_notification_id); $$;

revoke all on function public.delete_notification(text, uuid) from public;
grant execute on function public.delete_notification(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
