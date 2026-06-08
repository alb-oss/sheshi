
ALTER VIEW public.message_stats SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.is_banned(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.enforce_vote_on_main() FROM anon, authenticated, public;

ALTER FUNCTION public.enforce_vote_on_main() SET search_path = public;
