CREATE TABLE public.admin_account (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  username text NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  iterations integer NOT NULL,
  session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_account TO service_role;
ALTER TABLE public.admin_account ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.admin_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_login_attempts_ip_created_idx ON public.admin_login_attempts (ip, created_at DESC);
CREATE INDEX admin_login_attempts_created_idx ON public.admin_login_attempts (created_at DESC);
GRANT ALL ON public.admin_login_attempts TO service_role;
ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;