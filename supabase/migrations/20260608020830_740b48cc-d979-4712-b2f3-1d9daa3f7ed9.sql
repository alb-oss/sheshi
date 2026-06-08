
-- Fix 1: Prevent banned users from un-banning themselves via profiles update
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;

CREATE POLICY "profiles self update"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id
  AND banned_at IS NOT DISTINCT FROM (SELECT p.banned_at FROM public.profiles p WHERE p.id = auth.uid())
);

-- Fix 2: Split message update into author (body only) vs moderator (anything, incl. deleted_at)
DROP POLICY IF EXISTS "messages author or mod update" ON public.messages;

CREATE POLICY "messages author update body"
ON public.messages
FOR UPDATE
USING (auth.uid() = author_id AND NOT public.is_banned(auth.uid()))
WITH CHECK (
  auth.uid() = author_id
  AND room_id    IS NOT DISTINCT FROM (SELECT m.room_id    FROM public.messages m WHERE m.id = messages.id)
  AND parent_id  IS NOT DISTINCT FROM (SELECT m.parent_id  FROM public.messages m WHERE m.id = messages.id)
  AND author_id  IS NOT DISTINCT FROM (SELECT m.author_id  FROM public.messages m WHERE m.id = messages.id)
  AND image_url  IS NOT DISTINCT FROM (SELECT m.image_url  FROM public.messages m WHERE m.id = messages.id)
  AND deleted_at IS NOT DISTINCT FROM (SELECT m.deleted_at FROM public.messages m WHERE m.id = messages.id)
);

CREATE POLICY "messages mod update"
ON public.messages
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'moderator'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'moderator'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);
