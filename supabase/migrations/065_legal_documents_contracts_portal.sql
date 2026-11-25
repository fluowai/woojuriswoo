-- ============================================================
-- 065_legal_documents_contracts_portal.sql
-- WooJuris — Repositório documental com quarentena, versões,
-- hash SHA-256, modelos versionados, contratos, assinaturas,
-- portal do cliente e bucket privado isolado por escritório/pasta.
-- ============================================================

-- 1. Bucket privado para documentos jurídicos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'legal-documents',
  'legal-documents',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS de storage: isolamento estrito por account_id e verificação de acesso à pasta
DROP POLICY IF EXISTS "Legal members can read legal documents" ON storage.objects;
CREATE POLICY "Legal members can read legal documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'legal-documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
    AND (
      (storage.foldername(name))[2] IS NULL
      OR (storage.foldername(name))[2] = 'general'
      OR public.can_access_matter(((storage.foldername(name))[2])::uuid)
    )
  );

DROP POLICY IF EXISTS "Legal agents can upload legal documents" ON storage.objects;
CREATE POLICY "Legal agents can upload legal documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'legal-documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- 2. Documentos e Versões (preserva original e separa derivados/OCR/publicado)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'peca' CHECK (category IN ('procuracao', 'contrato', 'peca', 'prova', 'comprovante', 'decisao', 'certidao', 'parecer', 'outros')),
  confidentiality_level TEXT NOT NULL DEFAULT 'interno' CHECK (confidentiality_level IN ('publico_portal', 'interno', 'restrito', 'sigiloso')),
  quarantine_status TEXT NOT NULL DEFAULT 'quarentena' CHECK (quarantine_status IN ('quarentena', 'aprovado', 'bloqueado')),
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  retention_until DATE,
  current_version_number INTEGER NOT NULL DEFAULT 1,
  portal_published BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_matter ON documents(account_id, matter_id);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON documents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  artifact_kind TEXT NOT NULL DEFAULT 'original' CHECK (artifact_kind IN ('original', 'derivado_pdf', 'ocr_pesquisavel', 'comprovante', 'publicado')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256_hash TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  origin_source TEXT NOT NULL DEFAULT 'upload_manual',
  ocr_status TEXT NOT NULL DEFAULT 'nao_aplicavel' CHECK (ocr_status IN ('nao_aplicavel', 'pendente', 'homologacao', 'concluido', 'falhou')),
  extracted_text_indexed BOOLEAN NOT NULL DEFAULT false,
  uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, version_number, artifact_kind)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON document_versions(document_id, version_number DESC);
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

-- 3. Modelos Versionados (DOCX / PDF / HTML)
CREATE TABLE IF NOT EXISTS document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('proposta', 'contrato_honorarios', 'aditivo', 'distrato', 'procuracao', 'substabelecimento', 'autorizacao', 'peca')),
  practice_area TEXT NOT NULL DEFAULT 'civel',
  output_format TEXT NOT NULL DEFAULT 'docx_pdf' CHECK (output_format IN ('docx_pdf', 'pdf', 'docx')),
  current_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS document_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  body_template TEXT NOT NULL,
  typed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'revisao', 'aprovado', 'arquivado')),
  approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version_number)
);

ALTER TABLE document_template_versions ENABLE ROW LEVEL SECURITY;

-- 4. Contratos, Aditivos e Assinaturas
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  parent_contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
  template_version_id UUID REFERENCES document_template_versions(id) ON DELETE SET NULL,
  contract_number TEXT NOT NULL,
  title TEXT NOT NULL,
  contract_kind TEXT NOT NULL DEFAULT 'honorarios' CHECK (contract_kind IN ('honorarios', 'aditivo', 'distrato', 'procuracao', 'consultoria_recorrente')),
  scope_description TEXT NOT NULL,
  fee_model TEXT NOT NULL DEFAULT 'fixo' CHECK (fee_model IN ('fixo', 'parcelado', 'recorrente', 'exito', 'misto')),
  total_value_cents BIGINT NOT NULL DEFAULT 0,
  installments_count INTEGER NOT NULL DEFAULT 1,
  success_fee_percent NUMERIC(5,2),
  success_fee_condition TEXT,
  readjustment_index TEXT DEFAULT 'IPCA',
  effective_from DATE,
  effective_until DATE,
  auto_renew BOOLEAN NOT NULL DEFAULT false,
  signature_method TEXT NOT NULL DEFAULT 'manual_comprovado' CHECK (signature_method IN ('eletronica_simples', 'eletronica_avancada', 'icp_brasil', 'manual_comprovado')),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'revisao', 'aprovado', 'enviado', 'assinado', 'recusado', 'expirado', 'cancelado')),
  receivables_generated BOOLEAN NOT NULL DEFAULT false,
  signed_at TIMESTAMPTZ,
  manual_evidence_hash TEXT,
  manual_evidence_note TEXT,
  approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contract_number)
);

CREATE INDEX IF NOT EXISTS idx_contracts_matter ON contracts(account_id, matter_id, status);
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON contracts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS contract_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  rendered_content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  pdf_storage_path TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, version_number)
);

ALTER TABLE contract_versions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS signature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('documenso', 'manual')),
  external_envelope_id TEXT,
  signers JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'parcialmente_assinado', 'assinado', 'recusado', 'expirado', 'estornado')),
  expires_at TIMESTAMPTZ,
  final_file_sha256 TEXT,
  final_file_storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE signature_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS signature_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  signature_request_id UUID NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, signature_request_id, provider_event_id)
);

ALTER TABLE signature_events ENABLE ROW LEVEL SECURITY;

-- 5. Portal do Cliente (convite autenticado, representações vigentes e publicações explícitas)
CREATE TABLE IF NOT EXISTS portal_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES people_entities(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  scope_role TEXT NOT NULL DEFAULT 'cliente' CHECK (scope_role IN ('cliente', 'representante')),
  is_revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_invitations_matter ON portal_invitations(account_id, matter_id);
ALTER TABLE portal_invitations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS portal_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  publication_type TEXT NOT NULL CHECK (publication_type IN ('andamento', 'pendencia', 'documento', 'agenda', 'contrato', 'cobranca', 'mensagem')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  linked_resource_id UUID,
  contains_sensitive_info BOOLEAN NOT NULL DEFAULT false,
  approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  client_acknowledged_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_publications_matter ON portal_publications(account_id, matter_id, published_at DESC);
ALTER TABLE portal_publications ENABLE ROW LEVEL SECURITY;

-- Policies RLS
DROP POLICY IF EXISTS documents_select ON documents;
CREATE POLICY documents_select ON documents FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS documents_write ON documents;
CREATE POLICY documents_write ON documents FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS document_versions_select ON document_versions;
CREATE POLICY document_versions_select ON document_versions FOR SELECT USING (
  EXISTS (SELECT 1 FROM documents d WHERE d.id = document_versions.document_id AND can_access_matter(d.matter_id))
);
DROP POLICY IF EXISTS document_versions_write ON document_versions;
CREATE POLICY document_versions_write ON document_versions FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS document_templates_select ON document_templates;
CREATE POLICY document_templates_select ON document_templates FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS document_templates_write ON document_templates;
CREATE POLICY document_templates_write ON document_templates FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS document_template_versions_select ON document_template_versions;
CREATE POLICY document_template_versions_select ON document_template_versions FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS document_template_versions_write ON document_template_versions;
CREATE POLICY document_template_versions_write ON document_template_versions FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contracts_select ON contracts;
CREATE POLICY contracts_select ON contracts FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS contracts_write ON contracts;
CREATE POLICY contracts_write ON contracts FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contract_versions_select ON contract_versions;
CREATE POLICY contract_versions_select ON contract_versions FOR SELECT USING (
  EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_versions.contract_id AND can_access_matter(c.matter_id))
);
DROP POLICY IF EXISTS contract_versions_write ON contract_versions;
CREATE POLICY contract_versions_write ON contract_versions FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS signature_requests_select ON signature_requests;
CREATE POLICY signature_requests_select ON signature_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM contracts c WHERE c.id = signature_requests.contract_id AND can_access_matter(c.matter_id))
);
DROP POLICY IF EXISTS signature_requests_write ON signature_requests;
CREATE POLICY signature_requests_write ON signature_requests FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS signature_events_select ON signature_events;
CREATE POLICY signature_events_select ON signature_events FOR SELECT USING (is_account_member(account_id, 'viewer'));
DROP POLICY IF EXISTS signature_events_write ON signature_events;
CREATE POLICY signature_events_write ON signature_events FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS portal_invitations_select ON portal_invitations;
CREATE POLICY portal_invitations_select ON portal_invitations FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS portal_invitations_write ON portal_invitations;
CREATE POLICY portal_invitations_write ON portal_invitations FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS portal_publications_select ON portal_publications;
CREATE POLICY portal_publications_select ON portal_publications FOR SELECT USING (can_access_matter(matter_id));
DROP POLICY IF EXISTS portal_publications_write ON portal_publications;
CREATE POLICY portal_publications_write ON portal_publications FOR ALL USING (can_access_matter(matter_id) AND is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
