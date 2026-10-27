CREATE TABLE public.prepaid_accounts (
  phone text PRIMARY KEY,
  name text,
  credit double precision NOT NULL DEFAULT 0 CHECK (credit >= 0),
  net_points double precision NOT NULL DEFAULT 0,
  session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.prepaid_accounts TO service_role;
ALTER TABLE public.prepaid_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.active_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL REFERENCES public.prepaid_accounts(phone) ON DELETE CASCADE,
  package text NOT NULL,
  devices integer NOT NULL DEFAULT 1,
  price integer NOT NULL DEFAULT 0,
  expiry timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'credit',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX active_subscriptions_phone_idx ON public.active_subscriptions (phone, status, expiry);
GRANT ALL ON public.active_subscriptions TO service_role;
ALTER TABLE public.active_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.subscription_devices (
  subscription_id uuid NOT NULL REFERENCES public.active_subscriptions(id) ON DELETE CASCADE,
  mac text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, mac)
);
CREATE INDEX subscription_devices_mac_idx ON public.subscription_devices (mac);
GRANT ALL ON public.subscription_devices TO service_role;
ALTER TABLE public.subscription_devices ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.phone_otps (
  phone text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sends_in_window integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.phone_otps TO service_role;
ALTER TABLE public.phone_otps ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.free_wifi_claims (
  phone text NOT NULL,
  mac text NOT NULL,
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone, day),
  UNIQUE (mac, day)
);
GRANT ALL ON public.free_wifi_claims TO service_role;
ALTER TABLE public.free_wifi_claims ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transactions ADD COLUMN purpose text NOT NULL DEFAULT 'package';
COMMENT ON COLUMN public.transactions.purpose IS 'package = pay-and-activate (old portal); topup = add amount to prepaid credit, then buy transactions.package from credit';

-- Atomic credit operations (server only)
CREATE OR REPLACE FUNCTION public.add_credit(_phone text, _amount double precision)
RETURNS double precision
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.prepaid_accounts (phone, credit) VALUES (_phone, GREATEST(_amount, 0))
  ON CONFLICT (phone) DO UPDATE SET credit = public.prepaid_accounts.credit + GREATEST(_amount, 0), updated_at = now()
  RETURNING credit;
$$;

CREATE OR REPLACE FUNCTION public.spend_credit(_phone text, _amount double precision)
RETURNS double precision
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.prepaid_accounts SET credit = credit - _amount, updated_at = now()
  WHERE phone = _phone AND _amount >= 0 AND credit >= _amount
  RETURNING credit;
$$;

REVOKE ALL ON FUNCTION public.add_credit(text, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spend_credit(text, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credit(text, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.spend_credit(text, double precision) TO service_role;