-- ============================================================
-- 062_legal_intake_clients_conflicts.sql
-- WooJuris — Pessoas PF/PJ, partes, relacionamentos, múltiplos
-- números de WhatsApp por escritório, triagem/oportunidades,
-- consultas e verificação de conflitos de interesses.
-- ============================================================

-- 1. Permite múltiplos números de WhatsApp por escritório com roteamento
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS label TEXT DEFAULT 'Principal',
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES office_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_queue TEXT DEFAULT 'triagem_geral',
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT true;

-- Remove restrição de 1 número por conta para suportar filiais/múltiplos números
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- 2. Consentimento e finalidade de comunicação no contato WACRM
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS communication_purpose TEXT,
  ADD COLUMN IF NOT EXISTS authorized_channels TEXT[] NOT NULL DEFAULT ARRAY['whatsapp']::text[],
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shared_phone_flag BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merged_into_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

-- 3. Pessoas e Entidades (PF/PJ, clientes, partes, testemunhas, peritos, adversos)
CREATE TABLE IF NOT EXISTS people_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  person_type TEXT NOT NULL DEFAULT 'PF' CHECK (person_type IN ('PF', 'PJ')),
  full_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  cpf_cnpj TEXT,
  cpf_cnpj_normalized TEXT,
  oab_number TEXT,
  economic_group TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  state TEXT,
  notes TEXT,
  is_client BOOLEAN NOT NULL DEFAULT false,
  is_confidential BOOLEAN NOT NULL DEFAULT false,
  merged_into_id UUID REFERENCES people_entities(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_people_entities_account ON people_entities(account_id);
CREATE INDEX IF NOT EXISTS idx_people_entities_norm_name ON people_entities(account_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_people_entities_doc ON people_entities(account_id, cpf_cnpj_normalized) WHERE cpf_cnpj_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_people_entities_contact ON people_entities(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE people_entities ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON people_entities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON people_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. Relacionamentos entre pessoas/entidades (representante, sócio, grupo econômico)
CREATE TABLE IF NOT EXISTS entity_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES people_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES people_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('representante_legal', 'procurador', 'socio', 'grupo_economico', 'responsavel_financeiro', 'contato')),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  revoked_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_entity_id <> target_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_relationships_account ON entity_relationships(account_id);
ALTER TABLE entity_relationships ENABLE ROW LEVEL SECURITY;

-- 5. Atendimentos / Oportunidades jurídicas (distinto de cliente, pasta e processo)
CREATE TABLE IF NOT EXISTS legal_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES office_units(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  client_entity_id UUID REFERENCES people_entities(id) ON DELETE SET NULL,
  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  origin_channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (origin_channel IN ('whatsapp', 'formulario', 'email', 'telefone', 'indicacao', 'manual')),
  practice_area TEXT NOT NULL DEFAULT 'civel' CHECK (practice_area IN ('civel', 'familia', 'trabalhista', 'previdenciario', 'criminal', 'empresarial', 'tributario', 'consumidor', 'consultivo')),
  reported_urgency TEXT NOT NULL DEFAULT 'media' CHECK (reported_urgency IN ('baixa', 'media', 'alta', 'critica')),
  queue_name TEXT NOT NULL DEFAULT 'triagem_geral',
  business_hours_received BOOLEAN NOT NULL DEFAULT true,
  sla_due_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  stage TEXT NOT NULL DEFAULT 'triagem' CHECK (stage IN ('triagem', 'conflito', 'consulta', 'proposta', 'contratacao', 'convertido', 'arquivado')),
  summary TEXT,
  opposing_party_name TEXT,
  opposing_party_document TEXT,
  proposal_value_cents BIGINT,
  proposal_summary TEXT,
  proposal_sent_at TIMESTAMPTZ,
  conflict_status TEXT NOT NULL DEFAULT 'nao_verificado' CHECK (conflict_status IN ('nao_verificado', 'pendente_revisao', 'liberado', 'liberado_com_excecao', 'bloqueado')),
  converted_matter_id UUID,
  conversion_idempotency_key TEXT,
  archived_reason TEXT,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_intakes_account_stage ON legal_intakes(account_id, stage);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_intakes_idempotency ON legal_intakes(account_id, conversion_idempotency_key) WHERE conversion_idempotency_key IS NOT NULL;
ALTER TABLE legal_intakes ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON legal_intakes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON legal_intakes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Agenda de Consultas (presencial/remota, reagendamento, ausência)
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  intake_id UUID REFERENCES legal_intakes(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  unit_id UUID REFERENCES office_units(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  modality TEXT NOT NULL DEFAULT 'remota' CHECK (modality IN ('presencial', 'remota')),
  location_or_link TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada', 'confirmada', 'reagendada', 'realizada', 'ausencia', 'cancelada')),
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  absence_notes TEXT,
  reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_appointments_account_starts ON appointments(account_id, starts_at);
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON appointments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Verificação de Conflitos e Candidatos
CREATE TABLE IF NOT EXISTS conflict_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  intake_id UUID REFERENCES legal_intakes(id) ON DELETE SET NULL,
  matter_id UUID,
  trigger_reason TEXT NOT NULL DEFAULT 'triagem' CHECK (trigger_reason IN ('triagem', 'nova_contraparte', 'mudanca_escopo', 'revisao_periodica')),
  query_name TEXT NOT NULL,
  query_document_normalized TEXT,
  query_aliases TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  query_economic_group TEXT,
  status TEXT NOT NULL DEFAULT 'pendente_revisao' CHECK (status IN ('sem_conflito', 'pendente_revisao', 'falso_positivo', 'conflito_confirmado', 'excecao_autorizada')),
  decision_justification TEXT,
  evidence_summary TEXT,
  requested_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conflict_checks_account ON conflict_checks(account_id, status);
ALTER TABLE conflict_checks ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON conflict_checks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON conflict_checks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS conflict_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conflict_check_id UUID NOT NULL REFERENCES conflict_checks(id) ON DELETE CASCADE,
  matched_entity_id UUID REFERENCES people_entities(id) ON DELETE SET NULL,
  matched_matter_id UUID,
  match_type TEXT NOT NULL CHECK (match_type IN ('identificador_exato', 'nome_normalizado', 'similaridade', 'alias', 'grupo_economico', 'parte_adversa')),
  similarity_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  is_under_secrecy BOOLEAN NOT NULL DEFAULT false,
  minimal_signal TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'pendente' CHECK (disposition IN ('pendente', 'falso_positivo', 'conflito_real', 'excecao')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conflict_candidates_check ON conflict_candidates(conflict_check_id);
ALTER TABLE conflict_candidates ENABLE ROW LEVEL SECURITY;

-- Policies RLS
DROP POLICY IF EXISTS people_entities_select ON people_entities;
CREATE POLICY people_entities_select ON people_entities FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS people_entities_write ON people_entities;
CREATE POLICY people_entities_write ON people_entities FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS entity_relationships_select ON entity_relationships;
CREATE POLICY entity_relationships_select ON entity_relationships FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS entity_relationships_write ON entity_relationships;
CREATE POLICY entity_relationships_write ON entity_relationships FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS legal_intakes_select ON legal_intakes;
CREATE POLICY legal_intakes_select ON legal_intakes FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS legal_intakes_write ON legal_intakes;
CREATE POLICY legal_intakes_write ON legal_intakes FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS appointments_select ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS appointments_write ON appointments;
CREATE POLICY appointments_write ON appointments FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS conflict_checks_select ON conflict_checks;
CREATE POLICY conflict_checks_select ON conflict_checks FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS conflict_checks_write ON conflict_checks;
CREATE POLICY conflict_checks_write ON conflict_checks FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS conflict_candidates_select ON conflict_candidates;
CREATE POLICY conflict_candidates_select ON conflict_candidates FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS conflict_candidates_write ON conflict_candidates;
CREATE POLICY conflict_candidates_write ON conflict_candidates FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
