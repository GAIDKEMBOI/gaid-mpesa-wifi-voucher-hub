-- Customers with internet access (one row per access session)
CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text,
  mac text NOT NULL,
  package text NOT NULL,
  expiry timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disconnected')),
  source text NOT NULL DEFAULT 'mpesa' CHECK (source IN ('mpesa','voucher','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_mac_idx ON public.users (mac);
CREATE INDEX users_status_expiry_idx ON public.users (status, expiry);
CREATE INDEX users_created_idx ON public.users (created_at);
GRANT ALL ON public.users TO service_role;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- M-Pesa payments
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  mac text NOT NULL,
  package text NOT NULL,
  amount integer NOT NULL,
  mpesa_code text,
  merchant_request_id text,
  checkout_request_id text,
  callback_token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','cancelled')),
  result_desc text,
  is_mock boolean NOT NULL DEFAULT false,
  last_query_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transactions_checkout_idx ON public.transactions (checkout_request_id);
CREATE INDEX transactions_created_idx ON public.transactions (created_at);
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Prepaid voucher codes
CREATE TABLE public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  package text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  used_by_mac text,
  used_at timestamptz,
  batch text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vouchers_created_idx ON public.vouchers (created_at);
GRANT ALL ON public.vouchers TO service_role;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

-- Blocked devices
CREATE TABLE public.blocked_macs (
  mac text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.blocked_macs TO service_role;
ALTER TABLE public.blocked_macs ENABLE ROW LEVEL SECURITY;

-- No policies: all access goes through server code using the service role.