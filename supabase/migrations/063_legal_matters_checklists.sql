-- ============================================================
-- 063_legal_matters_checklists.sql
-- WooJuris — Pastas jurídicas (judiciais e extrajudiciais sem CNJ),
-- barreiras de sigilo com precedência absoluta, equipe, partes,
-- checklists versionados por área e conversão idempotente.
-- ============================================================

-- 1. Pastas Jurídicas (matters)
CREATE TABLE IF NOT EXISTS matters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES office_units(id) ON DELETE SET NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  origin_intake_id UUID REFERENCES legal_intakes(id) ON DELETE SET NULL,
  origin_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  matter_type TEXT NOT NULL DEFAULT 'judicial' CHECK (matter_type IN ('judicial', 'extrajudicial', 'consultoria', 'parecer', 'negociacao', 'cartorio', 'administrativo')),
  practice_area TEXT NOT NULL DEFAULT 'civel' CHECK (practice_area IN ('civel', 'familia', 'trabalhista', 'previdenciario', 'criminal', 'empresarial', 'tributario', 'consumidor', 'consultivo')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('triagem', 'ativo', 'aguardando_cliente', 'suspenso', 'encerramento_pendente', 'encerrado', 'arquivado')),
  priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa', 'media', 'alta', 'urgente')),
  object_description TEXT,
  restricted_strategy TEXT,
  next_step TEXT,
  claim_value_cents BIGINT,
  lead_lawyer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_restricted BOOLEAN NOT NULL DEFAULT false,
  confidentiality_level TEXT NOT NULL DEFAULT 'interno' CHECK (confidentiality_level IN ('interno', 'restrito', 'sigiloso')),
  closure_checklist_completed BOOLEAN NOT NULL DEFAULT false,
  accountability_completed BOOLEAN NOT NULL DEFAULT false,
  client_delivery_approved BOOLEAN NOT NULL DEFAULT false,
  retention_policy_years INTEGER NOT NULL DEFAULT 5,
  closed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, code)
);

CREATE INDEX IF NOT EXISTS idx_matters_account_status ON matters(account_id, status);
CREATE INDEX IF NOT EXISTS idx_matters_lead_lawyer ON matters(account_id, lead_lawyer_user_id);
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON matters;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON matters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Referência cruzada aditiva em legal_intakes e conflict_checks
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_intakes_converted_matter_fk') THEN
    ALTER TABLE legal_intakes
      ADD CONSTRAINT legal_intakes_converted_matter_fk
      FOREIGN KEY (converted_matter_id) REFERENCES matters(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Membros da pasta (incluindo correspondentes externos temporários)
CREATE TABLE IF NOT EXISTS matter_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL DEFAULT 'advogado' CHECK (member_role IN ('responsavel', 'coordenador', 'advogado', 'assistente', 'correspondente_externo', 'auditor')),
  can_view_strategy BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  access_expires_at TIMESTAMPTZ,
  added_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (matter_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_matter_members_lookup ON matter_members(account_id, matter_id, user_id);
ALTER TABLE matter_members ENABLE ROW LEVEL SECURITY;

-- 3. Lista explícita de acesso para pastas restritas (Ethical Wall / Sigilo)
CREATE TABLE IF NOT EXISTS matter_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'read_write' CHECK (access_level IN ('read', 'read_write', 'admin')),
  granted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (matter_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_matter_access_grants_lookup ON matter_access_grants(account_id, matter_id, user_id);
ALTER TABLE matter_access_grants ENABLE ROW LEVEL SECURITY;

-- 4. Função central de acesso à pasta — BARREIRA DE SIGILO TEM PRECEDÊNCIA ABSOLUTA
CREATE OR REPLACE FUNCTION public.can_access_matter(target_matter_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_is_restricted BOOLEAN;
  v_role legal_role_enum;
BEGIN
  SELECT m.account_id, m.is_restricted
  INTO v_account_id, v_is_restricted
  FROM matters m
  WHERE m.id = target_matter_id;

  IF v_account_id IS NULL THEN
    RETURN false;
  END IF;

  -- Break-glass excepcional de plataforma SaaS (auditado e temporário)
  IF has_active_break_glass(v_account_id, target_matter_id) THEN
    RETURN true;
  END IF;

  -- Verifica se pertence ao mesmo escritório
  IF NOT is_account_member(v_account_id, 'viewer') THEN
    RETURN false;
  END IF;

  v_role := current_legal_role(v_account_id);

  -- Operação SaaS sem break-glass nunca acessa pastas
  IF v_role = 'platform_ops' THEN
    RETURN false;
  END IF;

  -- PRECEDÊNCIA ABSOLUTA DE SIGILO:
  -- Em pasta restrita, mesmo partner_admin / owner precisa de grant explícito ativo
  IF v_is_restricted THEN
    RETURN EXISTS (
      SELECT 1 FROM matter_access_grants g
      WHERE g.matter_id = target_matter_id
        AND g.account_id = v_account_id
        AND g.user_id = auth.uid()
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > NOW())
    ) OR EXISTS (
      SELECT 1 FROM matter_members mm
      WHERE mm.matter_id = target_matter_id
        AND mm.account_id = v_account_id
        AND mm.user_id = auth.uid()
        AND mm.is_active = true
        AND mm.revoked_at IS NULL
        AND (mm.access_expires_at IS NULL OR mm.access_expires_at > NOW())
    );
  END IF;

  -- Pastas não restritas: perfis internos do escritório têm acesso conforme papel
  IF v_role IN ('partner_admin', 'coordinator', 'auditor', 'finance', 'reception') THEN
    RETURN true;
  END IF;

  -- Advogados e assistentes acessam se forem membros ou responsáveis da pasta (ou pasta aberta da equipe)
  RETURN EXISTS (
    SELECT 1 FROM matters m
    WHERE m.id = target_matter_id
      AND (
        m.lead_lawyer_user_id = auth.uid()
        OR m.created_by_user_id = auth.uid()
        OR m.team_id IS NULL
        OR EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = m.team_id AND tm.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM matter_members mm
          WHERE mm.matter_id = m.id
            AND mm.user_id = auth.uid()
            AND mm.is_active = true
            AND mm.revoked_at IS NULL
            AND (mm.access_expires_at IS NULL OR mm.access_expires_at > NOW())
        )
      )
  );
END;
$$;

ALTER FUNCTION public.can_access_matter(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.can_access_matter(UUID) TO authenticated, service_role;

-- 5. Partes da Pasta (múltiplos clientes, contrapartes, testemunhas, peritos, advogado adverso)
CREATE TABLE IF NOT EXISTS matter_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES people_entities(id) ON DELETE CASCADE,
  party_role TEXT NOT NULL CHECK (party_role IN ('cliente', 'autor', 'reu', 'representante', 'contraparte', 'advogado_adverso', 'testemunha', 'perito', 'terceiro_interessado')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  poa_registered BOOLEAN NOT NULL DEFAULT false,
  poa_valid_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (matter_id, entity_id, party_role)
);

CREATE INDEX IF NOT EXISTS idx_matter_parties_matter ON matter_parties(account_id, matter_id);
ALTER TABLE matter_parties ENABLE ROW LEVEL SECURITY;

-- 6. Checklists configuráveis e versionados por área e tipo de demanda
CREATE TABLE IF NOT EXISTS checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  practice_area TEXT NOT NULL CHECK (practice_area IN ('civel', 'familia', 'trabalhista', 'previdenciario', 'criminal', 'empresarial', 'tributario', 'consumidor', 'consultivo')),
  demand_type TEXT NOT NULL DEFAULT 'geral',
  stage_target TEXT NOT NULL DEFAULT 'abertura' CHECK (stage_target IN ('consulta', 'abertura', 'andamento', 'encerramento')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name, practice_area)
);

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS checklist_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  changelog TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version_number)
);

ALTER TABLE checklist_template_versions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS matter_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  template_version_id UUID REFERENCES checklist_template_versions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matter_checklists_matter ON matter_checklists(account_id, matter_id);
ALTER TABLE matter_checklists ENABLE ROW LEVEL SECURITY;

-- 7. RPC de conversão idempotente de atendimento/oportunidade em pasta jurídica
CREATE OR REPLACE FUNCTION public.convert_intake_to_matter(
  p_intake_id UUID,
  p_idempotency_key TEXT,
  p_matter_type TEXT DEFAULT 'judicial',
  p_is_restricted BOOLEAN DEFAULT false,
  p_lead_lawyer_user_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intake legal_intakes%ROWTYPE;
  v_account_conflict_block BOOLEAN;
  v_existing_matter_id UUID;
  v_new_matter_id UUID;
  v_code TEXT;
  v_lead UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_intake FROM legal_intakes WHERE id = p_intake_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intake not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT is_account_member(v_intake.account_id, 'agent') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Idempotência: se já foi convertida ou mesma chave já usada, retorna a mesma pasta
  IF v_intake.converted_matter_id IS NOT NULL THEN
    RETURN v_intake.converted_matter_id;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT converted_matter_id INTO v_existing_matter_id
    FROM legal_intakes
    WHERE account_id = v_intake.account_id
      AND conversion_idempotency_key = p_idempotency_key
      AND converted_matter_id IS NOT NULL
    LIMIT 1;
    IF v_existing_matter_id IS NOT NULL THEN
      RETURN v_existing_matter_id;
    END IF;
  END IF;

  -- Bloqueio de contratação quando política exigir conflito decidido
  SELECT conflict_block_hiring INTO v_account_conflict_block
  FROM accounts WHERE id = v_intake.account_id;

  IF COALESCE(v_account_conflict_block, true)
     AND v_intake.conflict_status NOT IN ('liberado', 'liberado_com_excecao') THEN
    RAISE EXCEPTION 'Verificação de conflitos pendente ou bloqueada impede a conversão'
      USING ERRCODE = '22023';
  END IF;

  v_lead := COALESCE(p_lead_lawyer_user_id, v_intake.assigned_user_id, auth.uid());
  v_code := 'PST-' || to_char(NOW(), 'YYYY') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO matters (
    account_id, unit_id, origin_intake_id, origin_conversation_id,
    code, title, matter_type, practice_area, status,
    object_description, lead_lawyer_user_id, is_restricted,
    confidentiality_level, created_by_user_id
  ) VALUES (
    v_intake.account_id, v_intake.unit_id, v_intake.id, v_intake.conversation_id,
    v_code, v_intake.title, p_matter_type, v_intake.practice_area, 'ativo',
    v_intake.summary, v_lead, p_is_restricted,
    CASE WHEN p_is_restricted THEN 'sigiloso' ELSE 'interno' END, auth.uid()
  )
  RETURNING id INTO v_new_matter_id;

  -- Garante acesso explícito do responsável e do criador (crucial para pastas restritas)
  INSERT INTO matter_members (account_id, matter_id, user_id, member_role, can_view_strategy, added_by_user_id)
  VALUES (v_intake.account_id, v_new_matter_id, v_lead, 'responsavel', true, auth.uid())
  ON CONFLICT (matter_id, user_id) DO NOTHING;

  IF p_is_restricted THEN
    INSERT INTO matter_access_grants (account_id, matter_id, user_id, access_level, granted_by_user_id, reason)
    VALUES (v_intake.account_id, v_new_matter_id, v_lead, 'admin', auth.uid(), 'Responsável na abertura da pasta restrita')
    ON CONFLICT (matter_id, user_id) DO NOTHING;
  END IF;

  -- Vincula cliente como parte principal se presente
  IF v_intake.client_entity_id IS NOT NULL THEN
    INSERT INTO matter_parties (account_id, matter_id, entity_id, party_role, is_primary)
    VALUES (v_intake.account_id, v_new_matter_id, v_intake.client_entity_id, 'cliente', true)
    ON CONFLICT (matter_id, entity_id, party_role) DO NOTHING;
  END IF;

  UPDATE legal_intakes
  SET stage = 'convertido',
      converted_matter_id = v_new_matter_id,
      conversion_idempotency_key = COALESCE(p_idempotency_key, conversion_idempotency_key)
  WHERE id = v_intake.id;

  INSERT INTO audit_events (account_id, actor_user_id, operation, resource_type, resource_id, scope_type, scope_id, outcome, metadata)
  VALUES (
    v_intake.account_id, auth.uid(), 'intake.convert_to_matter', 'matter', v_new_matter_id::text,
    'matter', v_new_matter_id, 'allowed',
    jsonb_build_object('intake_id', v_intake.id, 'idempotency_key', p_idempotency_key, 'is_restricted', p_is_restricted)
  );

  RETURN v_new_matter_id;
END;
$$;

ALTER FUNCTION public.convert_intake_to_matter(UUID, TEXT, TEXT, BOOLEAN, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.convert_intake_to_matter(UUID, TEXT, TEXT, BOOLEAN, UUID) TO authenticated, service_role;

-- Policies RLS de matters e entidades filhas (usando can_access_matter!)
DROP POLICY IF EXISTS matters_select ON matters;
CREATE POLICY matters_select ON matters FOR SELECT USING (can_access_matter(id));
DROP POLICY IF EXISTS matters_insert ON matters;
CREATE POLICY matters_insert ON matters FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS matters_update ON matters;
CREATE POLICY matters_update ON matters FOR UPDATE USING (can_access_matter(id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS matter_members_select ON matter_members;
CREATE POLICY matter_members_select ON matter_members FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS matter_members_write ON matter_members;
CREATE POLICY matter_members_write ON matter_members FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS matter_access_grants_select ON matter_access_grants;
CREATE POLICY matter_access_grants_select ON matter_access_grants FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS matter_access_grants_write ON matter_access_grants;
CREATE POLICY matter_access_grants_write ON matter_access_grants FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS matter_parties_select ON matter_parties;
CREATE POLICY matter_parties_select ON matter_parties FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS matter_parties_write ON matter_parties;
CREATE POLICY matter_parties_write ON matter_parties FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS checklist_templates_select ON checklist_templates;
CREATE POLICY checklist_templates_select ON checklist_templates FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS checklist_templates_write ON checklist_templates;
CREATE POLICY checklist_templates_write ON checklist_templates FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS checklist_template_versions_select ON checklist_template_versions;
CREATE POLICY checklist_template_versions_select ON checklist_template_versions FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS checklist_template_versions_write ON checklist_template_versions;
CREATE POLICY checklist_template_versions_write ON checklist_template_versions FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS matter_checklists_select ON matter_checklists;
CREATE POLICY matter_checklists_select ON matter_checklists FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS matter_checklists_write ON matter_checklists;
CREATE POLICY matter_checklists_write ON matter_checklists FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
