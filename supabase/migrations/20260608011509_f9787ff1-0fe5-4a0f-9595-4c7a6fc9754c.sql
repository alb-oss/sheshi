
-- Enum for roles
CREATE TYPE public.app_role AS ENUM ('user', 'moderator', 'admin');
CREATE TYPE public.report_reason AS ENUM ('spam', 'hate', 'doxxing', 'violence', 'other');
CREATE TYPE public.report_status AS ENUM ('open', 'resolved', 'dismissed');

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  banned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles public read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles read own" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

-- has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_banned(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND banned_at IS NOT NULL)
$$;

-- auto-create profile + assign user role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    LOWER(split_part(NEW.email, '@', 1)) || '_' || substr(NEW.id::text, 1, 4)
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- rooms
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rooms TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rooms public read" ON public.rooms FOR SELECT USING (true);

INSERT INTO public.rooms (slug, name, description) VALUES
  ('sheshi', '#sheshi', 'Sheshi qendror — diskutim i përgjithshëm qytetar.'),
  ('vjosa-narta', '#vjosa-narta', 'Mbrojtja e Vjosës dhe Nartës.'),
  ('tirana', '#tirana', 'Çështje qytetare në Tiranë.'),
  ('shkodra', '#shkodra', 'Çështje qytetare në Shkodër.'),
  ('korca', '#korca', 'Çështje qytetare në Korçë.');

-- messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  image_url TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_room_created ON public.messages (room_id, created_at DESC) WHERE parent_id IS NULL;
CREATE INDEX messages_parent ON public.messages (parent_id);
GRANT SELECT ON public.messages TO anon, authenticated;
GRANT INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages public read" ON public.messages FOR SELECT USING (true);
CREATE POLICY "messages author insert" ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = author_id AND NOT public.is_banned(auth.uid()));
CREATE POLICY "messages author or mod update" ON public.messages FOR UPDATE
  USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin'));

-- votes
CREATE TABLE public.votes (
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
GRANT SELECT ON public.votes TO anon, authenticated;
GRANT INSERT, DELETE ON public.votes TO authenticated;
GRANT ALL ON public.votes TO service_role;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "votes public read" ON public.votes FOR SELECT USING (true);
CREATE POLICY "votes self insert" ON public.votes FOR INSERT
  WITH CHECK (auth.uid() = user_id AND NOT public.is_banned(auth.uid()));
CREATE POLICY "votes self delete" ON public.votes FOR DELETE USING (auth.uid() = user_id);

-- enforce votes only on main messages
CREATE OR REPLACE FUNCTION public.enforce_vote_on_main()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.messages WHERE id = NEW.message_id AND parent_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot vote on replies';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER votes_main_only BEFORE INSERT ON public.votes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vote_on_main();

-- reports
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason report_reason NOT NULL,
  note TEXT CHECK (char_length(note) <= 500),
  status report_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.reports TO authenticated;
GRANT SELECT, UPDATE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports self insert" ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "reports mod read" ON public.reports FOR SELECT
  USING (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "reports mod update" ON public.reports FOR UPDATE
  USING (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin'));

-- message_stats view
CREATE OR REPLACE VIEW public.message_stats AS
SELECT
  m.id AS message_id,
  COALESCE(v.upvotes, 0) AS upvotes,
  COALESCE(r.reply_count, 0) AS reply_count
FROM public.messages m
LEFT JOIN (SELECT message_id, COUNT(*)::int AS upvotes FROM public.votes GROUP BY message_id) v ON v.message_id = m.id
LEFT JOIN (SELECT parent_id, COUNT(*)::int AS reply_count FROM public.messages WHERE parent_id IS NOT NULL AND deleted_at IS NULL GROUP BY parent_id) r ON r.parent_id = m.id
WHERE m.parent_id IS NULL;

GRANT SELECT ON public.message_stats TO anon, authenticated;

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.votes;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.votes REPLICA IDENTITY FULL;
