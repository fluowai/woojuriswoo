-- ============================================================
-- 061_legal_identity_governance.sql
-- WooJuris (Wootech) — Identidade jurídica, unidades, equipes,
-- papéis granulares, auditoria imutável, LGPD e governança OAB/SaaS.
-- ============================================================

-- 1. Enum de perfis jurídicos (9 perfis conforme matriz de acesso)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'legal_role_enum') THEN
    CREATE TYPE legal_role_enum AS ENUM (
      'platform_ops',
      'partner_admin',
      'coordinator',
      'lawyer',
      'assistant',
      'reception',
      'finance',
      'client',
      'auditor'
    );
  END IF;
END $$;

-- 2. Extensão aditiva da tabela accounts (escritório / tenant)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS brand_name TEXT NOT NULL DEFAULT 'WooJuris',
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS cnpj TEXT,
  ADD COLUMN IF NOT EXISTS oab_society_number TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS saas_plan TEXT NOT NULL DEFAULT 'escritorio',
  ADD COLUMN IF NOT EXISTS oab_compliance_mode BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS broadcasts_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_autonomous_disabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS api_keys_broad_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conflict_block_hiring BOOLEAN NOT NULL DEFAULT true;

-- 3. Unidades / Filiais do escritório
CREATE TABLE IF NOT EXISTS office_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  city TEXT,
  state TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  is_headquarters BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, code)
);

CREATE INDEX IF NOT EXISTS idx_office_units_account ON office_units(account_id);
ALTER TABLE office_units ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON office_units;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON office_units
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. Equipes internas
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES office_units(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  practice_area TEXT,
  coordinator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_account ON teams(account_id);
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON teams;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_lead BOOLEAN NOT NULL DEFAULT false,
  substitute_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_account ON team_members(account_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- 5. Extensão aditiva de profiles com papel jurídico e MFA
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS legal_role legal_role_enum,
  ADD COLUMN IF NOT EXISTS oab_number TEXT,
  ADD COLUMN IF NOT EXISTS oab_uf TEXT,
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES office_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_platform_ops BOOLEAN NOT NULL DEFAULT false;

-- Backfill de legal_role preservando hierarquia existente
UPDATE profiles
SET legal_role = CASE account_role
  WHEN 'owner'  THEN 'partner_admin'::legal_role_enum
  WHEN 'admin'  THEN 'partner_admin'::legal_role_enum
  WHEN 'agent'  THEN 'lawyer'::legal_role_enum
  WHEN 'viewer' THEN 'auditor'::legal_role_enum
  ELSE 'assistant'::legal_role_enum
END
WHERE legal_role IS NULL;

-- 6. Grants granulares por ação/recurso/escopo
CREATE TABLE IF NOT EXISTS role_permission_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_role legal_role_enum,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'account' CHECK (scope_type IN ('account', 'unit', 'team', 'matter', 'item')),
  scope_id UUID,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow', 'deny')),
  granted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_permission_grants_account ON role_permission_grants(account_id);
ALTER TABLE role_permission_grants ENABLE ROW LEVEL SECURITY;

-- 7. Acesso excepcional (Break-glass) para operação SaaS
CREATE TABLE IF NOT EXISTS break_glass_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  operator_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  authorized_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) >= 10),
  scope TEXT NOT NULL DEFAULT 'diagnostics' CHECK (scope IN ('diagnostics', 'support_read', 'incident_recovery')),
  matter_id UUID,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_break_glass_grants_account ON break_glass_grants(account_id, operator_user_id, expires_at);
ALTER TABLE break_glass_grants ENABLE ROW LEVEL SECURITY;

-- 8. Trilha de auditoria imutável (append-only)
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT,
  operation TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  scope_type TEXT DEFAULT 'account',
  scope_id UUID,
  outcome TEXT NOT NULL DEFAULT 'allowed' CHECK (outcome IN ('allowed', 'denied', 'failed')),
  reason TEXT,
  correlation_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_account_created ON audit_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(account_id, resource_type, resource_id);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Protege audit_events contra UPDATE e DELETE por usuários autenticados
CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'audit_events is append-only and cannot be modified or deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.prevent_audit_event_mutation() OWNER TO postgres;

DROP TRIGGER IF EXISTS prevent_audit_event_mutation ON audit_events;
CREATE TRIGGER prevent_audit_event_mutation
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();

-- 9. Retenção legal (Litigation Hold) e Pedidos de Titulares (LGPD DSAR)
CREATE TABLE IF NOT EXISTS retention_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('matter', 'person', 'document', 'conversation', 'contract', 'finance')),
  resource_id UUID NOT NULL,
  reason TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  placed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  release_after DATE,
  released_at TIMESTAMPTZ,
  released_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retention_holds_account ON retention_holds(account_id, resource_type, resource_id);
ALTER TABLE retention_holds ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS data_subject_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requester_name TEXT NOT NULL,
  requester_document_masked TEXT,
  requester_email TEXT,
  request_type TEXT NOT NULL CHECK (request_type IN ('acesso', 'correcao', 'anonimizacao', 'eliminacao', 'portabilidade', 'revogacao')),
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'verificando_identidade', 'em_analise_sigilo', 'atendido', 'parcialmente_atendido', 'indeferido')),
  identity_verified BOOLEAN NOT NULL DEFAULT false,
  third_party_secrecy_reviewed BOOLEAN NOT NULL DEFAULT false,
  retention_blocked BOOLEAN NOT NULL DEFAULT false,
  justification TEXT,
  response_summary TEXT,
  due_date DATE NOT NULL DEFAULT (CURRENT_DATE + 15),
  handled_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsar_account ON data_subject_requests(account_id, status);
ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON data_subject_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 10. Domínio separado para assinatura SaaS da plataforma
CREATE TABLE IF NOT EXISTS saas_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'escritorio',
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'canceled')),
  seats_limit INTEGER NOT NULL DEFAULT 10,
  storage_gb_limit INTEGER NOT NULL DEFAULT 50,
  monthly_price_cents BIGINT NOT NULL DEFAULT 0,
  billing_cycle_anchor DATE,
  external_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE saas_subscriptions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON saas_subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON saas_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 11. Helpers SQL de papel jurídico e RLS base
CREATE OR REPLACE FUNCTION public.current_legal_role(target_account_id UUID)
RETURNS legal_role_enum
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    p.legal_role,
    CASE p.account_role
      WHEN 'owner'  THEN 'partner_admin'::legal_role_enum
      WHEN 'admin'  THEN 'partner_admin'::legal_role_enum
      WHEN 'agent'  THEN 'lawyer'::legal_role_enum
      WHEN 'viewer' THEN 'auditor'::legal_role_enum
    END
  )
  FROM profiles p
  WHERE p.user_id = auth.uid()
    AND p.account_id = target_account_id
  LIMIT 1;
$$;

ALTER FUNCTION public.current_legal_role(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.current_legal_role(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_active_break_glass(target_account_id UUID, target_matter_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM break_glass_grants bg
    WHERE bg.account_id = target_account_id
      AND bg.operator_user_id = auth.uid()
      AND bg.revoked_at IS NULL
      AND NOW() BETWEEN bg.starts_at AND bg.expires_at
      AND (target_matter_id IS NULL OR bg.matter_id IS NULL OR bg.matter_id = target_matter_id)
  );
$$;

ALTER FUNCTION public.has_active_break_glass(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.has_active_break_glass(UUID, UUID) TO authenticated, service_role;

-- Policies RLS das tabelas de governança
DROP POLICY IF EXISTS office_units_select ON office_units;
CREATE POLICY office_units_select ON office_units FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS office_units_write ON office_units;
CREATE POLICY office_units_write ON office_units FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS teams_select ON teams;
CREATE POLICY teams_select ON teams FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS teams_write ON teams;
CREATE POLICY teams_write ON teams FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS team_members_select ON team_members;
CREATE POLICY team_members_select ON team_members FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS team_members_write ON team_members;
CREATE POLICY team_members_write ON team_members FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS role_permission_grants_select ON role_permission_grants;
CREATE POLICY role_permission_grants_select ON role_permission_grants FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS role_permission_grants_write ON role_permission_grants;
CREATE POLICY role_permission_grants_write ON role_permission_grants FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS break_glass_grants_select ON break_glass_grants;
CREATE POLICY break_glass_grants_select ON break_glass_grants FOR SELECT USING (is_account_member(account_id, 'admin') OR operator_user_id = auth.uid());
DROP POLICY IF EXISTS break_glass_grants_write ON break_glass_grants;
CREATE POLICY break_glass_grants_write ON break_glass_grants FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS audit_events_select ON audit_events;
CREATE POLICY audit_events_select ON audit_events FOR SELECT USING (
  is_account_member(account_id, 'viewer')
  AND current_legal_role(account_id) IN ('partner_admin', 'coordinator', 'auditor', 'lawyer', 'finance')
);
DROP POLICY IF EXISTS audit_events_insert ON audit_events;
CREATE POLICY audit_events_insert ON audit_events FOR INSERT WITH CHECK (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS retention_holds_select ON retention_holds;
CREATE POLICY retention_holds_select ON retention_holds FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS retention_holds_write ON retention_holds;
CREATE POLICY retention_holds_write ON retention_holds FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS dsar_select ON data_subject_requests;
CREATE POLICY dsar_select ON data_subject_requests FOR SELECT USING (
  is_account_member(account_id, 'viewer')
  AND current_legal_role(account_id) IN ('partner_admin', 'coordinator', 'auditor')
);
DROP POLICY IF EXISTS dsar_write ON data_subject_requests;
CREATE POLICY dsar_write ON data_subject_requests FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS saas_subscriptions_select ON saas_subscriptions;
CREATE POLICY saas_subscriptions_select ON saas_subscriptions FOR SELECT USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS saas_subscriptions_write ON saas_subscriptions;
CREATE POLICY saas_subscriptions_write ON saas_subscriptions FOR ALL USING (is_account_member(account_id, 'owner')) WITH CHECK (is_account_member(account_id, 'owner'));
