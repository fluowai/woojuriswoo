-- ============================================================
-- 066_legal_finance_ops_imports.sql
-- WooJuris — Financeiro jurídico em centavos (BIGINT), separação
-- conta escritório vs terceiros/clientes, conciliação bancária,
-- integrações, filas inbox/outbox, importação CSV com rollback,
-- logs de IA assistiva e atualização de redeem_invitation.
-- ============================================================

-- 1. Contas contábeis/operacionais separando Escritório vs Terceiros/Clientes
CREATE TABLE IF NOT EXISTS client_fund_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_kind TEXT NOT NULL CHECK (account_kind IN ('escritorio_propria', 'terceiros_clientes', 'custas_reembolsaveis')),
  bank_name TEXT,
  agency_masked TEXT,
  account_masked TEXT,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

ALTER TABLE client_fund_accounts ENABLE ROW LEVEL SECURITY;

-- 2. Condições de Honorários (fee_terms)
CREATE TABLE IF NOT EXISTS fee_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  fee_kind TEXT NOT NULL CHECK (fee_kind IN ('fixo', 'parcelado', 'recorrente', 'exito', 'misto')),
  principal_cents BIGINT NOT NULL DEFAULT 0 CHECK (principal_cents >= 0),
  installments_count INTEGER NOT NULL DEFAULT 1 CHECK (installments_count >= 1),
  success_percent NUMERIC(5,2),
  success_condition_validated BOOLEAN NOT NULL DEFAULT false,
  success_validated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  success_validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fee_terms ENABLE ROW LEVEL SECURITY;

-- 3. Contas a Receber / Títulos (receivables) — idempotente por contrato
CREATE TABLE IF NOT EXISTS receivables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
  fund_account_id UUID REFERENCES client_fund_accounts(id) ON DELETE SET NULL,
  revenue_class TEXT NOT NULL DEFAULT 'receita_propria' CHECK (revenue_class IN ('receita_propria', 'valor_terceiros', 'credito_a_receber', 'reembolso_custas')),
  description TEXT NOT NULL,
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'parcial', 'pago', 'estornado', 'cancelado', 'inadimplente')),
  competence_month DATE NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_idempotency
  ON receivables(account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receivables_matter ON receivables(account_id, matter_id, status);
ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;

-- 4. Parcelas (installments)
CREATE TABLE IF NOT EXISTS installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  receivable_id UUID NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL CHECK (installment_number >= 1),
  due_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'parcial', 'pago', 'estornado', 'cancelado', 'atrasado')),
  billing_provider TEXT DEFAULT 'manual' CHECK (billing_provider IN ('manual', 'pix_adapter', 'boleto_adapter')),
  external_charge_id TEXT,
  nfse_status TEXT DEFAULT 'nao_emitida' CHECK (nfse_status IN ('nao_emitida', 'homologacao', 'emitida', 'cancelada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (receivable_id, installment_number)
);

CREATE INDEX IF NOT EXISTS idx_installments_due ON installments(account_id, status, due_date);
ALTER TABLE installments ENABLE ROW LEVEL SECURITY;

-- 5. Despesas, Custas, Reembolsos e Repasses
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES matters(id) ON DELETE SET NULL,
  unit_id UUID REFERENCES office_units(id) ON DELETE SET NULL,
  fund_account_id UUID REFERENCES client_fund_accounts(id) ON DELETE SET NULL,
  expense_kind TEXT NOT NULL CHECK (expense_kind IN ('despesa_escritorio', 'custa_processual', 'reembolso_cliente', 'repasse_terceiro', 'correspondente')),
  cost_center TEXT NOT NULL DEFAULT 'geral',
  description TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'pago', 'reembolsado', 'estornado', 'cancelado')),
  receipt_storage_path TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_account ON expenses(account_id, status, due_date);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- 6. Pagamentos, Alocações (baixa parcial/estorno) e Livro Razão (ledger_entries)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fund_account_id UUID REFERENCES client_fund_accounts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('entrada', 'saida')),
  payment_method TEXT NOT NULL DEFAULT 'manual' CHECK (payment_method IN ('manual', 'pix', 'boleto', 'ted', 'cartao', 'alvara')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'confirmado' CHECK (status IN ('pendente', 'confirmado', 'estornado', 'cancelado')),
  external_reference TEXT,
  idempotency_key TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'pendente' CHECK (reconciliation_status IN ('pendente', 'conciliado', 'divergente')),
  notes TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency
  ON payments(account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS settlement_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES installments(id) ON DELETE SET NULL,
  expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  allocated_cents BIGINT NOT NULL CHECK (allocated_cents > 0),
  is_reversal BOOLEAN NOT NULL DEFAULT false,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE settlement_allocations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES matters(id) ON DELETE SET NULL,
  fund_account_id UUID REFERENCES client_fund_accounts(id) ON DELETE SET NULL,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('credito', 'debito', 'estorno')),
  revenue_class TEXT NOT NULL DEFAULT 'receita_propria' CHECK (revenue_class IN ('receita_propria', 'valor_terceiros', 'credito_a_receber', 'despesa')),
  amount_cents BIGINT NOT NULL,
  competence_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cash_date DATE,
  reference_type TEXT NOT NULL,
  reference_id UUID,
  description TEXT NOT NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_date ON ledger_entries(account_id, competence_date DESC);
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fund_account_id UUID REFERENCES client_fund_accounts(id) ON DELETE SET NULL,
  source_filename TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  total_lines INTEGER NOT NULL DEFAULT 0,
  matched_lines INTEGER NOT NULL DEFAULT 0,
  unmatched_lines INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'em_revisao' CHECK (status IN ('em_revisao', 'concluida', 'estornada', 'falhou')),
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;

-- 7. Operação: Conexões de Integração, Sync Jobs, Inbox/Outbox, CSV Import e IA Assistiva
CREATE TABLE IF NOT EXISTS integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('datajud', 'djen', 'dje', 'eproc', 'pje', 'esaj', 'documenso', 'gotenberg', 'ocrmypdf', 'pix_boleto', 'nfse', 'ai_assist')),
  mode TEXT NOT NULL DEFAULT 'homologacao' CHECK (mode IN ('indisponivel', 'homologacao', 'producao')),
  status TEXT NOT NULL DEFAULT 'nao_configurado' CHECK (status IN ('nao_configurado', 'ativo', 'erro_auth', 'rate_limited', 'indisponivel')),
  allow_auto_acknowledgement BOOLEAN NOT NULL DEFAULT false,
  config_public JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_health_check_at TIMESTAMPTZ,
  last_error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, provider)
);

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('datajud_sync', 'ocr_document', 'pdf_render', 'export_report', 'deadline_alert', 'reconciliation')),
  dedup_key TEXT,
  status TEXT NOT NULL DEFAULT 'enfileirado' CHECK (status IN ('enfileirado', 'executando', 'concluido', 'falhou', 'redrive', 'cancelado')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_jobs_active_dedup
  ON sync_jobs(account_id, job_type, dedup_key)
  WHERE dedup_key IS NOT NULL AND status IN ('enfileirado', 'executando');
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS inbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'recebido' CHECK (status IN ('recebido', 'processado', 'duplicado', 'fora_de_ordem', 'falhou')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (account_id, provider, external_event_id)
);

ALTER TABLE inbox_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'falhou', 'descartado')),
  attempts INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, idempotency_key)
);

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS csv_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_module TEXT NOT NULL CHECK (target_module IN ('clients', 'cases', 'deadlines', 'finance')),
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  skipped_duplicates INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'previa' CHECK (status IN ('previa', 'importado', 'rollback_parcial', 'rollback_concluido', 'falhou')),
  created_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  inconsistency_report JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE csv_import_batches ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ai_assist_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES matters(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  task_kind TEXT NOT NULL CHECK (task_kind IN ('classificar_mensagem', 'resumir_autos', 'extrair_campos', 'preparar_minuta')),
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  human_decision TEXT NOT NULL DEFAULT 'pendente' CHECK (human_decision IN ('pendente', 'aceito', 'editado', 'rejeitado')),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_assist_logs ENABLE ROW LEVEL SECURITY;

-- 8. RPC Idempotente: Contrato assinado gera títulos/parcelas uma única vez
CREATE OR REPLACE FUNCTION public.generate_contract_receivables(
  p_contract_id UUID,
  p_first_due_date DATE DEFAULT CURRENT_DATE
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract contracts%ROWTYPE;
  v_existing_id UUID;
  v_receivable_id UUID;
  v_base_amount BIGINT;
  v_remainder BIGINT;
  v_i INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_contract FROM contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT is_account_member(v_contract.account_id, 'agent') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_contract.status <> 'assinado' THEN
    RAISE EXCEPTION 'Somente contratos assinados podem gerar títulos' USING ERRCODE = '22023';
  END IF;

  -- Idempotência estrita: nunca duplica parcelas para o mesmo contrato
  SELECT id INTO v_existing_id
  FROM receivables
  WHERE account_id = v_contract.account_id
    AND idempotency_key = 'contract:' || v_contract.id::text
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  IF v_contract.total_value_cents <= 0 THEN
    RAISE EXCEPTION 'Contrato sem valor fixo/parcelado definido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO receivables (
    account_id, matter_id, contract_id, revenue_class,
    description, total_cents, idempotency_key
  ) VALUES (
    v_contract.account_id, v_contract.matter_id, v_contract.id, 'receita_propria',
    'Honorários — ' || v_contract.title, v_contract.total_value_cents,
    'contract:' || v_contract.id::text
  )
  RETURNING id INTO v_receivable_id;

  v_base_amount := v_contract.total_value_cents / GREATEST(v_contract.installments_count, 1);
  v_remainder := v_contract.total_value_cents - (v_base_amount * GREATEST(v_contract.installments_count, 1));

  FOR v_i IN 1..GREATEST(v_contract.installments_count, 1) LOOP
    INSERT INTO installments (
      account_id, receivable_id, installment_number, due_date, amount_cents
    ) VALUES (
      v_contract.account_id,
      v_receivable_id,
      v_i,
      (p_first_due_date + ((v_i - 1) || ' months')::interval)::date,
      v_base_amount + CASE WHEN v_i = 1 THEN v_remainder ELSE 0 END
    );
  END LOOP;

  UPDATE contracts SET receivables_generated = true WHERE id = v_contract.id;

  RETURN v_receivable_id;
END;
$$;

ALTER FUNCTION public.generate_contract_receivables(UUID, DATE) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.generate_contract_receivables(UUID, DATE) TO authenticated, service_role;

-- Policies RLS das tabelas financeiras e operacionais
DROP POLICY IF EXISTS client_fund_accounts_select ON client_fund_accounts;
CREATE POLICY client_fund_accounts_select ON client_fund_accounts FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS client_fund_accounts_write ON client_fund_accounts;
CREATE POLICY client_fund_accounts_write ON client_fund_accounts FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS fee_terms_select ON fee_terms;
CREATE POLICY fee_terms_select ON fee_terms FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS fee_terms_write ON fee_terms;
CREATE POLICY fee_terms_write ON fee_terms FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS receivables_select ON receivables;
CREATE POLICY receivables_select ON receivables FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS receivables_write ON receivables;
CREATE POLICY receivables_write ON receivables FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS installments_select ON installments;
CREATE POLICY installments_select ON installments FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS installments_write ON installments;
CREATE POLICY installments_write ON installments FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS expenses_select ON expenses;
CREATE POLICY expenses_select ON expenses FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS expenses_write ON expenses;
CREATE POLICY expenses_write ON expenses FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS payments_select ON payments;
CREATE POLICY payments_select ON payments FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS payments_write ON payments;
CREATE POLICY payments_write ON payments FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS settlement_allocations_select ON settlement_allocations;
CREATE POLICY settlement_allocations_select ON settlement_allocations FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS settlement_allocations_write ON settlement_allocations;
CREATE POLICY settlement_allocations_write ON settlement_allocations FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ledger_entries_select ON ledger_entries;
CREATE POLICY ledger_entries_select ON ledger_entries FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS ledger_entries_write ON ledger_entries;
CREATE POLICY ledger_entries_write ON ledger_entries FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS reconciliation_runs_select ON reconciliation_runs;
CREATE POLICY reconciliation_runs_select ON reconciliation_runs FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS reconciliation_runs_write ON reconciliation_runs;
CREATE POLICY reconciliation_runs_write ON reconciliation_runs FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS integration_connections_select ON integration_connections;
CREATE POLICY integration_connections_select ON integration_connections FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS integration_connections_write ON integration_connections;
CREATE POLICY integration_connections_write ON integration_connections FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sync_jobs_select ON sync_jobs;
CREATE POLICY sync_jobs_select ON sync_jobs FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS sync_jobs_write ON sync_jobs;
CREATE POLICY sync_jobs_write ON sync_jobs FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS inbox_events_select ON inbox_events;
CREATE POLICY inbox_events_select ON inbox_events FOR SELECT USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS outbox_events_select ON outbox_events;
CREATE POLICY outbox_events_select ON outbox_events FOR SELECT USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS csv_import_batches_select ON csv_import_batches;
CREATE POLICY csv_import_batches_select ON csv_import_batches FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS csv_import_batches_write ON csv_import_batches;
CREATE POLICY csv_import_batches_write ON csv_import_batches FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_assist_logs_select ON ai_assist_logs;
CREATE POLICY ai_assist_logs_select ON ai_assist_logs FOR SELECT USING (
  is_account_member(account_id, 'viewer') AND (matter_id IS NULL OR can_access_matter(matter_id))
);
DROP POLICY IF EXISTS ai_assist_logs_write ON ai_assist_logs;
CREATE POLICY ai_assist_logs_write ON ai_assist_logs FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

-- WAHA channel table is declared before this function because migration 066
-- also includes the account-data guard used by invitation redemption.
CREATE TABLE IF NOT EXISTS public.waha_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, name TEXT NOT NULL, session_name TEXT NOT NULL,
  phone TEXT, status TEXT NOT NULL DEFAULT 'created', engine TEXT NOT NULL DEFAULT 'WEBJS', qr_code TEXT,
  last_error TEXT, webhook_url TEXT, connected_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(account_id, session_name)
);

-- 9. Atualiza redeem_invitation para checar todas as novas tabelas com account_id antes de remover conta solo
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM waha_instances WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM office_units WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM teams WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM team_members WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM role_permission_grants WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM break_glass_grants WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM audit_events WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM retention_holds WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM data_subject_requests WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM saas_subscriptions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM people_entities WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM entity_relationships WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM legal_intakes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM appointments WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conflict_checks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conflict_candidates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM matters WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM matter_members WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM matter_access_grants WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM matter_parties WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM checklist_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM checklist_template_versions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM matter_checklists WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM court_cases WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM matter_case_links WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM case_source_records WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM case_movements WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM legal_communications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM court_calendars WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM calendar_exceptions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deadlines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deadline_revisions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM hearings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM legal_tasks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM protocols WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM document_versions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM document_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM document_template_versions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contracts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contract_versions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM signature_requests WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM signature_events WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM portal_invitations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM portal_publications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM client_fund_accounts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM fee_terms WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM receivables WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM installments WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM expenses WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM payments WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM settlement_allocations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ledger_entries WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM reconciliation_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM integration_connections WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM sync_jobs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM inbox_events WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM outbox_events WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM csv_import_batches WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_assist_logs WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
