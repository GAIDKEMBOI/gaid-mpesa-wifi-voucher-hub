ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_source_check;
ALTER TABLE public.users ADD CONSTRAINT users_source_check CHECK (source IN ('mpesa','voucher','manual','credit','free'));