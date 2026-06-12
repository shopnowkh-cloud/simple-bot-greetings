CREATE TABLE public.admin_tokens (
  token text PRIMARY KEY,
  telegram_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
GRANT ALL ON public.admin_tokens TO service_role;
ALTER TABLE public.admin_tokens ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_admin_tokens_expires ON public.admin_tokens(expires_at);