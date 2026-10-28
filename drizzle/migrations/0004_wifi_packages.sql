CREATE TABLE public.wifi_packages (
  id text PRIMARY KEY,
  label text NOT NULL,
  price integer NOT NULL CHECK (price BETWEEN 1 AND 100000),
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 525600),
  devices integer NOT NULL DEFAULT 1 CHECK (devices BETWEEN 1 AND 20),
  speed_mbps integer CHECK (speed_mbps IS NULL OR speed_mbps BETWEEN 1 AND 10000),
  visible boolean NOT NULL DEFAULT true,
  removed boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.wifi_packages IS 'Packages the admin manages. removed = hidden everywhere but kept so old sessions, vouchers and payments still show their name.';
GRANT ALL ON public.wifi_packages TO service_role;
ALTER TABLE public.wifi_packages ENABLE ROW LEVEL SECURITY;

INSERT INTO public.wifi_packages (id, label, price, minutes, devices, speed_mbps, sort_order) VALUES
  ('30m', '30 Mins', 5, 30, 1, NULL, 10),
  ('1h', '1 Hour', 10, 60, 1, NULL, 20),
  ('2h', '2 Hours', 12, 120, 1, NULL, 30),
  ('4h', '4 Hours', 20, 240, 1, NULL, 40),
  ('12h', '12 Hours', 30, 720, 1, NULL, 50),
  ('24h', '24 Hours', 45, 1440, 1, NULL, 60),
  ('7d', '1 Week', 200, 10080, 1, NULL, 70),
  ('30d', '1 Month', 600, 43200, 1, NULL, 80),
  ('4h-2d', '4HRS 2 Devices', 30, 240, 2, 5, 90),
  ('24h-2d', '24HRS 2 Devices', 70, 1440, 2, 5, 100),
  ('3d-2d', '3 Days 2 Devices', 135, 4320, 2, 5, 110)
ON CONFLICT (id) DO NOTHING;