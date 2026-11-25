CREATE TABLE IF NOT EXISTS public.waha_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  session_name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','starting','qr','connected','stopping','disconnected','failed')),
  engine TEXT NOT NULL DEFAULT 'WEBJS',
  qr_code TEXT,
  last_error TEXT,
  webhook_url TEXT,
  connected_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, session_name)
);

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS waha_instance_id UUID REFERENCES public.waha_instances(id) ON DELETE SET NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS waha_instance_id UUID REFERENCES public.waha_instances(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_waha_instances_account ON public.waha_instances(account_id);
CREATE INDEX IF NOT EXISTS idx_conversations_waha ON public.conversations(account_id, waha_instance_id, last_message_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_waha_provider_id ON public.messages(waha_instance_id, message_id) WHERE waha_instance_id IS NOT NULL AND message_id IS NOT NULL;

ALTER TABLE public.waha_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waha_instances_select ON public.waha_instances;
DROP POLICY IF EXISTS waha_instances_insert ON public.waha_instances;
DROP POLICY IF EXISTS waha_instances_update ON public.waha_instances;
DROP POLICY IF EXISTS waha_instances_delete ON public.waha_instances;
CREATE POLICY waha_instances_select ON public.waha_instances FOR SELECT USING (is_account_member(account_id));
CREATE POLICY waha_instances_insert ON public.waha_instances FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY waha_instances_update ON public.waha_instances FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY waha_instances_delete ON public.waha_instances FOR DELETE USING (is_account_member(account_id, 'admin'));
