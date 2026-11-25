-- ============================================================
-- 064_legal_cases_datajud_communications.sql
-- WooJuris — Processos (manual e DataJud CNJ), vínculo N:N com
-- pastas, registros por fonte/instância, movimentos deduplicados,
-- central de comunicações, calendários, prazos com memória de
-- cálculo, audiências, tarefas e protocolos manuais com recibo.
-- ============================================================

-- 1. Processos Judiciais / Administrativos (court_cases)
CREATE TABLE IF NOT EXISTS court_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cnj_number TEXT,
  cnj_normalized TEXT,
  legacy_number TEXT,
  tribunal_code TEXT,
  tribunal_alias TEXT,
  degree TEXT DEFAULT 'G1',
  court_organ TEXT,
  judicial_system TEXT DEFAULT 'manual' CHECK (judicial_system IN ('datajud', 'eproc', 'pje', 'esaj', 'projudi', 'administrativo', 'manual')),
  case_class TEXT,
  subjects TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  filing_date DATE,
  case_status TEXT NOT NULL DEFAULT 'ativo' CHECK (case_status IN ('ativo', 'suspenso', 'arquivado', 'baixado', 'sobrestado')),
  is_sealed BOOLEAN NOT NULL DEFAULT false,
  parent_case_id UUID REFERENCES court_cases(id) ON DELETE SET NULL,
  relation_type TEXT CHECK (relation_type IN ('principal', 'incidente', 'recurso', 'cumprimento_sentenca', 'execucao', 'cautelar')),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_court_cases_account_cnj ON court_cases(account_id, cnj_normalized) WHERE cnj_normalized IS NOT NULL;
ALTER TABLE court_cases ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON court_cases;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON court_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Vínculo N:N entre Pastas e Processos (uma pasta pode ter 0..N processos; um processo pode vincular-se a pastas autorizadas)
CREATE TABLE IF NOT EXISTS matter_case_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  link_role TEXT NOT NULL DEFAULT 'principal' CHECK (link_role IN ('principal', 'incidente', 'recurso', 'execucao', 'conexo')),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (matter_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_matter_case_links_matter ON matter_case_links(account_id, matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_case_links_case ON matter_case_links(account_id, case_id);
ALTER TABLE matter_case_links ENABLE ROW LEVEL SECURITY;

-- 3. Registros por Origem / Instância (DataJud, eproc, PJe, e-SAJ, manual)
CREATE TABLE IF NOT EXISTS case_source_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL CHECK (source_name IN ('datajud', 'djen', 'dje', 'eproc', 'pje', 'esaj', 'manual')),
  source_record_id TEXT NOT NULL,
  tribunal_alias TEXT,
  degree TEXT,
  court_organ TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pendente' CHECK (sync_status IN ('ok', 'atrasado', 'sem_resultado', 'parcial', 'erro_auth', 'rate_limited', 'indisponivel', 'homologacao', 'pendente')),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  last_error_code TEXT,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, source_name, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_case_source_records_case ON case_source_records(account_id, case_id);
ALTER TABLE case_source_records ENABLE ROW LEVEL SECURITY;

-- 4. Movimentações Processuais (deduplicadas por fingerprint estável)
CREATE TABLE IF NOT EXISTS case_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  source_record_id UUID REFERENCES case_source_records(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL DEFAULT 'manual',
  external_code TEXT,
  fingerprint TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  complements JSONB NOT NULL DEFAULT '[]'::jsonb,
  received_out_of_order BOOLEAN NOT NULL DEFAULT false,
  is_public_metadata BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, case_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_case_movements_case_occurred ON case_movements(account_id, case_id, occurred_at DESC);
ALTER TABLE case_movements ENABLE ROW LEVEL SECURITY;

-- 5. Central de Comunicações Oficiais (separa movimentação, publicação, intimação, ciência, evento interno)
CREATE TABLE IF NOT EXISTS legal_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES matters(id) ON DELETE SET NULL,
  case_id UUID REFERENCES court_cases(id) ON DELETE SET NULL,
  communication_kind TEXT NOT NULL CHECK (communication_kind IN ('movimentacao', 'publicacao', 'intimacao', 'citacao', 'ciencia', 'evento_interno')),
  source_name TEXT NOT NULL CHECK (source_name IN ('datajud', 'djen', 'dje', 'eproc', 'pje', 'esaj', 'upload_arquivo', 'manual')),
  external_identifier TEXT,
  dedup_hash TEXT NOT NULL,
  official_link TEXT,
  document_storage_path TEXT,
  available_date DATE,
  publication_date DATE,
  acknowledgement_date DATE,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_out_of_order BOOLEAN NOT NULL DEFAULT false,
  queue_status TEXT NOT NULL DEFAULT 'nova' CHECK (queue_status IN ('nova', 'classificada', 'em_revisao', 'vinculada', 'descartada')),
  summary TEXT NOT NULL,
  content_excerpt TEXT,
  disposition_justification TEXT,
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, dedup_hash)
);

CREATE INDEX IF NOT EXISTS idx_legal_communications_queue ON legal_communications(account_id, queue_status, collected_at DESC);
ALTER TABLE legal_communications ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON legal_communications;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON legal_communications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Calendários Forenses e Exceções (feriados locais, suspensões)
CREATE TABLE IF NOT EXISTS court_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tribunal_code TEXT,
  locality TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  is_validated BOOLEAN NOT NULL DEFAULT false,
  validated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

ALTER TABLE court_calendars ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS calendar_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES court_calendars(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  end_date DATE,
  exception_type TEXT NOT NULL CHECK (exception_type IN ('feriado_nacional', 'feriado_estadual', 'feriado_municipal', 'suspensao_prazos', 'recesso_forense', 'indisponibilidade_sistema')),
  description TEXT NOT NULL,
  official_act_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_exceptions_cal ON calendar_exceptions(calendar_id, exception_date);
ALTER TABLE calendar_exceptions ENABLE ROW LEVEL SECURITY;

-- 7. Prazos Processuais e Revisões (sugerido -> em_revisao -> confirmado -> cumprido/cancelado/recalculado)
CREATE TABLE IF NOT EXISTS deadlines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  case_id UUID REFERENCES court_cases(id) ON DELETE SET NULL,
  communication_id UUID REFERENCES legal_communications(id) ON DELETE SET NULL,
  calendar_id UUID REFERENCES court_calendars(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  nature TEXT NOT NULL DEFAULT 'processual' CHECK (nature IN ('processual', 'material', 'administrativo', 'contratual', 'interno')),
  procedural_regime TEXT NOT NULL DEFAULT 'cpc_dias_uteis' CHECK (procedural_regime IN ('cpc_dias_uteis', 'penal_dias_corridos', 'trabalhista_clt', 'administrativo', 'manual')),
  rule_code TEXT,
  rule_version TEXT DEFAULT '2026.1',
  counting_days INTEGER,
  reference_event TEXT NOT NULL,
  start_date DATE NOT NULL,
  legal_due_date DATE NOT NULL,
  internal_due_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  calculation_memory JSONB NOT NULL DEFAULT '{}'::jsonb,
  requires_manual_review BOOLEAN NOT NULL DEFAULT true,
  requires_second_reviewer BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'sugerido' CHECK (status IN ('sugerido', 'em_revisao', 'confirmado', 'cumprido', 'cancelado', 'recalculado')),
  responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  validator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  second_reviewer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ,
  evidence_note TEXT,
  revision_number INTEGER NOT NULL DEFAULT 1,
  completed_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deadlines_account_due ON deadlines(account_id, status, legal_due_date);
CREATE INDEX IF NOT EXISTS idx_deadlines_matter ON deadlines(matter_id);
ALTER TABLE deadlines ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON deadlines;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deadlines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS deadline_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deadline_id UUID NOT NULL REFERENCES deadlines(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  previous_legal_due_date DATE,
  new_legal_due_date DATE NOT NULL,
  previous_internal_due_date DATE,
  new_internal_due_date DATE NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  calculation_memory JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alert_rescheduled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deadline_revisions_deadline ON deadline_revisions(deadline_id, revision_number DESC);
ALTER TABLE deadline_revisions ENABLE ROW LEVEL SECURITY;

-- 8. Audiências, Sustentações, Perícias, Diligências e Reuniões
CREATE TABLE IF NOT EXISTS hearings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  case_id UUID REFERENCES court_cases(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL DEFAULT 'audiencia' CHECK (event_type IN ('audiencia', 'reuniao', 'sustentacao', 'pericia', 'diligencia', 'tarefa')),
  title TEXT NOT NULL,
  public_minimal_summary TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  modality TEXT NOT NULL DEFAULT 'remota' CHECK (modality IN ('presencial', 'remota', 'hibrida')),
  location_or_link TEXT,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  preparation_notes TEXT,
  status TEXT NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada', 'confirmada', 'redesignada', 'realizada', 'ausencia', 'cancelada')),
  rescheduled_from_id UUID REFERENCES hearings(id) ON DELETE SET NULL,
  receipt_document_id UUID,
  responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_hearings_account_starts ON hearings(account_id, starts_at);
ALTER TABLE hearings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON hearings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hearings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. Tarefas jurídicas com subtarefas, dependências, recorrência e horas
CREATE TABLE IF NOT EXISTS legal_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES matters(id) ON DELETE CASCADE,
  deadline_id UUID REFERENCES deadlines(id) ON DELETE SET NULL,
  parent_task_id UUID REFERENCES legal_tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID REFERENCES legal_tasks(id) ON DELETE SET NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa', 'media', 'alta', 'urgente')),
  status TEXT NOT NULL DEFAULT 'a_fazer' CHECK (status IN ('a_fazer', 'em_andamento', 'em_revisao', 'concluida', 'cancelada')),
  due_date DATE,
  estimated_minutes INTEGER DEFAULT 0,
  logged_minutes INTEGER DEFAULT 0,
  recurrence_rule TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_tasks_account ON legal_tasks(account_id, status, due_date);
ALTER TABLE legal_tasks ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON legal_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON legal_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 10. Protocolos Manuais com Recibo Associado
CREATE TABLE IF NOT EXISTS protocols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  case_id UUID REFERENCES court_cases(id) ON DELETE SET NULL,
  protocol_number TEXT NOT NULL,
  protocol_type TEXT NOT NULL DEFAULT 'peticao' CHECK (protocol_type IN ('peticao', 'recurso', 'manifestacao', 'juntada', 'administrativo', 'cartorio')),
  system_name TEXT NOT NULL DEFAULT 'manual',
  filed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  receipt_filename TEXT,
  receipt_hash TEXT,
  receipt_storage_path TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protocols_matter ON protocols(account_id, matter_id, filed_at DESC);
ALTER TABLE protocols ENABLE ROW LEVEL SECURITY;

-- Policies RLS respeitando can_access_matter quando vinculadas a pastas
DROP POLICY IF EXISTS court_cases_select ON court_cases;
CREATE POLICY court_cases_select ON court_cases FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS court_cases_write ON court_cases;
CREATE POLICY court_cases_write ON court_cases FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS matter_case_links_select ON matter_case_links;
CREATE POLICY matter_case_links_select ON matter_case_links FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS matter_case_links_write ON matter_case_links;
CREATE POLICY matter_case_links_write ON matter_case_links FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS case_source_records_select ON case_source_records;
CREATE POLICY case_source_records_select ON case_source_records FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS case_source_records_write ON case_source_records;
CREATE POLICY case_source_records_write ON case_source_records FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS case_movements_select ON case_movements;
CREATE POLICY case_movements_select ON case_movements FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS case_movements_write ON case_movements;
CREATE POLICY case_movements_write ON case_movements FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS legal_communications_select ON legal_communications;
CREATE POLICY legal_communications_select ON legal_communications FOR SELECT USING (
  is_account_member(account_id, 'viewer')
  AND (matter_id IS NULL OR can_access_matter(matter_id))
);
DROP POLICY IF EXISTS legal_communications_write ON legal_communications;
CREATE POLICY legal_communications_write ON legal_communications FOR ALL USING (
  is_account_member(account_id, 'agent')
  AND (matter_id IS NULL OR can_access_matter(matter_id))
) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS court_calendars_select ON court_calendars;
CREATE POLICY court_calendars_select ON court_calendars FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS court_calendars_write ON court_calendars;
CREATE POLICY court_calendars_write ON court_calendars FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS calendar_exceptions_select ON calendar_exceptions;
CREATE POLICY calendar_exceptions_select ON calendar_exceptions FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS calendar_exceptions_write ON calendar_exceptions;
CREATE POLICY calendar_exceptions_write ON calendar_exceptions FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS deadlines_select ON deadlines;
CREATE POLICY deadlines_select ON deadlines FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS deadlines_write ON deadlines;
CREATE POLICY deadlines_write ON deadlines FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deadline_revisions_select ON deadline_revisions;
CREATE POLICY deadline_revisions_select ON deadline_revisions FOR SELECT USING (
  EXISTS (SELECT 1 FROM deadlines d WHERE d.id = deadline_revisions.deadline_id AND can_access_matter(d.matter_id))
);
DROP POLICY IF EXISTS deadline_revisions_write ON deadline_revisions;
CREATE POLICY deadline_revisions_write ON deadline_revisions FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS hearings_select ON hearings;
CREATE POLICY hearings_select ON hearings FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS hearings_write ON hearings;
CREATE POLICY hearings_write ON hearings FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS legal_tasks_select ON legal_tasks;
CREATE POLICY legal_tasks_select ON legal_tasks FOR SELECT USING (
  is_account_member(account_id, 'viewer') AND (matter_id IS NULL OR can_access_matter(matter_id))
);
DROP POLICY IF EXISTS legal_tasks_write ON legal_tasks;
CREATE POLICY legal_tasks_write ON legal_tasks FOR ALL USING (
  is_account_member(account_id, 'agent') AND (matter_id IS NULL OR can_access_matter(matter_id))
) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS protocols_select ON protocols;
CREATE POLICY protocols_select ON protocols FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS protocols_write ON protocols;
CREATE POLICY protocols_write ON protocols FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
