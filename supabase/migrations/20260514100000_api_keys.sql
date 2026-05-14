-- api_keys: persistent rotation list for AI provider keys (Tavily + Mistral).
-- Replaces the previous approach of comma-separated MISTRAL_API_KEYS /
-- TAVILY_API_KEYS env secrets, which had three problems:
--   1. Order was static — exhausted keys were retried first every invocation,
--      wasting ~1-3s per cold call to confirm they're still dead.
--   2. No visibility — only digests are readable from the platform secrets.
--   3. No admin-editable interface — adding a new key required CLI access
--      to `supabase secrets set` and careful list manipulation.
--
-- Edge functions read this table first; if empty for a provider they fall
-- back to env so the migration is non-breaking. When a key returns an
-- exhaustion code (Tavily: 401/429/432/433; Mistral: 402 / 429 free-tier),
-- the edge function updates is_exhausted=true + bumps position to max+1000,
-- effectively moving it to the bottom of the rotation. Non-exhausted keys
-- get tried first on every subsequent invocation.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           TEXT NOT NULL CHECK (provider IN ('tavily', 'mistral', 'google', 'lovable')),
  label              TEXT,
  key_value          TEXT NOT NULL,
  position           INTEGER NOT NULL DEFAULT 0,
  is_exhausted       BOOLEAN NOT NULL DEFAULT false,
  exhausted_reason   TEXT,
  last_exhausted_at  TIMESTAMPTZ,
  last_succeeded_at  TIMESTAMPTZ,
  -- Credits tracking — populated by the check-api-key edge function when
  -- the provider exposes usage info (Tavily /usage; Mistral ratelimit
  -- headers). Null means unknown / never checked.
  credits_used       INTEGER,
  credits_total      INTEGER,
  credits_checked_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Same key value can't be registered twice for the same provider.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_provider_value_uq
  ON public.api_keys (provider, key_value);

-- Ordered lookup: non-exhausted first, then by position ascending.
CREATE INDEX IF NOT EXISTS api_keys_provider_rank
  ON public.api_keys (provider, is_exhausted, position);

-- Trigger to keep updated_at fresh on any change.
CREATE OR REPLACE FUNCTION public.touch_api_keys_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_api_keys ON public.api_keys;
CREATE TRIGGER trg_touch_api_keys
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.touch_api_keys_updated_at();

-- RLS: only moderators (admin / coadmin / reviewer) can see or modify rows.
-- The edge functions use the service-role client which bypasses RLS, so
-- their reads/writes work regardless of policy.
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_mod_select ON public.api_keys;
CREATE POLICY api_keys_mod_select ON public.api_keys
  FOR SELECT TO authenticated
  USING (public.is_moderator(auth.uid()));

DROP POLICY IF EXISTS api_keys_mod_insert ON public.api_keys;
CREATE POLICY api_keys_mod_insert ON public.api_keys
  FOR INSERT TO authenticated
  WITH CHECK (public.is_moderator(auth.uid()));

DROP POLICY IF EXISTS api_keys_mod_update ON public.api_keys;
CREATE POLICY api_keys_mod_update ON public.api_keys
  FOR UPDATE TO authenticated
  USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));

DROP POLICY IF EXISTS api_keys_mod_delete ON public.api_keys;
CREATE POLICY api_keys_mod_delete ON public.api_keys
  FOR DELETE TO authenticated
  USING (public.is_moderator(auth.uid()));
