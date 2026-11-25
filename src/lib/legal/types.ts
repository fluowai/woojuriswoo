// ============================================================
// WooJuris (Wootech) — Tipos de domínio jurídico (Fases 0–5)
// ============================================================

export type LegalRole =
  | "platform_ops"
  | "partner_admin"
  | "coordinator"
  | "lawyer"
  | "assistant"
  | "reception"
  | "finance"
  | "client"
  | "auditor";

export const LEGAL_ROLES: readonly LegalRole[] = [
  "platform_ops",
  "partner_admin",
  "coordinator",
  "lawyer",
  "assistant",
  "reception",
  "finance",
  "client",
  "auditor",
] as const;

export const LEGAL_ROLE_LABELS: Record<LegalRole, string> = {
  platform_ops: "Operação SaaS",
  partner_admin: "Sócio / Administrador",
  coordinator: "Coordenador / Controller",
  lawyer: "Advogado",
  assistant: "Assistente / Estagiário",
  reception: "Recepção / Comercial",
  finance: "Financeiro",
  client: "Cliente / Representante",
  auditor: "Auditor Autorizado",
};

export type PracticeArea =
  | "civel"
  | "familia"
  | "trabalhista"
  | "previdenciario"
  | "criminal"
  | "empresarial"
  | "tributario"
  | "consumidor"
  | "consultivo";

export const PRACTICE_AREAS: readonly PracticeArea[] = [
  "civel",
  "familia",
  "trabalhista",
  "previdenciario",
  "criminal",
  "empresarial",
  "tributario",
  "consumidor",
  "consultivo",
] as const;

export const PRACTICE_AREA_LABELS: Record<PracticeArea, string> = {
  civel: "Cível",
  familia: "Família e Sucessões",
  trabalhista: "Trabalhista",
  previdenciario: "Previdenciário",
  criminal: "Criminal",
  empresarial: "Empresarial",
  tributario: "Tributário",
  consumidor: "Consumidor",
  consultivo: "Consultivo",
};

export type MatterType =
  | "judicial"
  | "extrajudicial"
  | "consultoria"
  | "parecer"
  | "negociacao"
  | "cartorio"
  | "administrativo";

export const MATTER_TYPE_LABELS: Record<MatterType, string> = {
  judicial: "Judicial",
  extrajudicial: "Extrajudicial",
  consultoria: "Consultoria",
  parecer: "Parecer",
  negociacao: "Negociação",
  cartorio: "Cartório",
  administrativo: "Contencioso Administrativo",
};

export type ConfidentialityLevel = "publico_portal" | "interno" | "restrito" | "sigiloso";

export interface OfficeUnit {
  id: string;
  account_id: string;
  name: string;
  code: string;
  city?: string;
  state?: string;
  timezone: string;
  is_headquarters: boolean;
  is_active: boolean;
}

export interface LegalTeam {
  id: string;
  account_id: string;
  unit_id?: string | null;
  name: string;
  practice_area?: PracticeArea | null;
  coordinator_user_id?: string | null;
  member_user_ids: string[];
}

export interface LegalUserContext {
  userId: string;
  accountId: string;
  legalRole: LegalRole;
  fullName: string;
  email: string;
  unitId?: string | null;
  teamIds: string[];
  oabNumber?: string | null;
  mfaEnrolled: boolean;
  activeBreakGlassMatterIds?: string[];
  hasAccountWideBreakGlass?: boolean;
}

export interface BreakGlassGrant {
  id: string;
  account_id: string;
  operator_user_id: string;
  authorized_by_user_id: string;
  reason: string;
  scope: "diagnostics" | "support_read" | "incident_recovery";
  matter_id?: string | null;
  starts_at: string;
  expires_at: string;
  revoked_at?: string | null;
}

export interface PersonEntity {
  id: string;
  account_id: string;
  contact_id?: string | null;
  person_type: "PF" | "PJ";
  full_name: string;
  normalized_name: string;
  aliases: string[];
  cpf_cnpj?: string | null;
  cpf_cnpj_normalized?: string | null;
  oab_number?: string | null;
  economic_group?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  is_client: boolean;
  is_confidential: boolean;
  shared_phone_flag?: boolean;
  merged_into_id?: string | null;
  communication_purpose?: string | null;
  authorized_channels?: string[];
  is_fixture?: boolean;
  created_at: string;
}

export type IntakeStage =
  | "triagem"
  | "conflito"
  | "consulta"
  | "proposta"
  | "contratacao"
  | "convertido"
  | "arquivado";

export type ConflictStatus =
  | "nao_verificado"
  | "pendente_revisao"
  | "liberado"
  | "liberado_com_excecao"
  | "bloqueado";

export interface LegalIntake {
  id: string;
  account_id: string;
  unit_id?: string | null;
  contact_id?: string | null;
  conversation_id?: string | null;
  client_entity_id?: string | null;
  assigned_user_id?: string | null;
  title: string;
  origin_channel: "whatsapp" | "formulario" | "email" | "telefone" | "indicacao" | "manual";
  practice_area: PracticeArea;
  reported_urgency: "baixa" | "media" | "alta" | "critica";
  queue_name: string;
  business_hours_received: boolean;
  sla_due_at?: string | null;
  stage: IntakeStage;
  summary?: string | null;
  opposing_party_name?: string | null;
  opposing_party_document?: string | null;
  proposal_value_cents?: number | null;
  proposal_summary?: string | null;
  conflict_status: ConflictStatus;
  converted_matter_id?: string | null;
  conversion_idempotency_key?: string | null;
  archived_reason?: string | null;
  reopened_count: number;
  selected_document_ids?: string[];
  is_fixture?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConflictCandidate {
  id: string;
  matched_entity_id?: string | null;
  matched_matter_id?: string | null;
  match_type:
    | "identificador_exato"
    | "nome_normalizado"
    | "similaridade"
    | "alias"
    | "grupo_economico"
    | "parte_adversa";
  similarity_score: number;
  is_under_secrecy: boolean;
  minimal_signal: string;
  disposition: "pendente" | "falso_positivo" | "conflito_real" | "excecao";
}

export interface ConflictCheck {
  id: string;
  account_id: string;
  intake_id?: string | null;
  matter_id?: string | null;
  trigger_reason: "triagem" | "nova_contraparte" | "mudanca_escopo" | "revisao_periodica";
  query_name: string;
  query_document_normalized?: string | null;
  query_aliases: string[];
  query_economic_group?: string | null;
  status:
    | "sem_conflito"
    | "pendente_revisao"
    | "falso_positivo"
    | "conflito_confirmado"
    | "excecao_autorizada";
  decision_justification?: string | null;
  evidence_summary?: string | null;
  requested_by_user_id?: string | null;
  decided_by_user_id?: string | null;
  decided_at?: string | null;
  candidates: ConflictCandidate[];
  created_at: string;
}

export interface MatterAccessGrant {
  user_id: string;
  access_level: "read" | "read_write" | "admin";
  granted_by_user_id?: string | null;
  reason?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
}

export interface MatterMember {
  user_id: string;
  full_name: string;
  member_role:
    | "responsavel"
    | "coordenador"
    | "advogado"
    | "assistente"
    | "correspondente_externo"
    | "auditor";
  can_view_strategy: boolean;
  is_active: boolean;
  access_expires_at?: string | null;
  revoked_at?: string | null;
}

export interface MatterParty {
  id: string;
  entity_id: string;
  entity_name: string;
  person_type: "PF" | "PJ";
  party_role:
    | "cliente"
    | "autor"
    | "reu"
    | "representante"
    | "contraparte"
    | "advogado_adverso"
    | "testemunha"
    | "perito"
    | "terceiro_interessado";
  is_primary: boolean;
  poa_registered: boolean;
  poa_valid_until?: string | null;
}

export interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  done: boolean;
  completed_by?: string | null;
  completed_at?: string | null;
}

export interface MatterChecklist {
  id: string;
  title: string;
  practice_area: PracticeArea;
  template_version: number;
  items: ChecklistItem[];
}

export interface Matter {
  id: string;
  account_id: string;
  unit_id?: string | null;
  team_id?: string | null;
  origin_intake_id?: string | null;
  origin_conversation_id?: string | null;
  code: string;
  title: string;
  matter_type: MatterType;
  practice_area: PracticeArea;
  status:
    | "triagem"
    | "ativo"
    | "aguardando_cliente"
    | "suspenso"
    | "encerramento_pendente"
    | "encerrado"
    | "arquivado";
  priority: "baixa" | "media" | "alta" | "urgente";
  object_description?: string | null;
  restricted_strategy?: string | null;
  next_step?: string | null;
  claim_value_cents?: number | null;
  lead_lawyer_user_id?: string | null;
  is_restricted: boolean;
  confidentiality_level: "interno" | "restrito" | "sigiloso";
  members: MatterMember[];
  access_grants: MatterAccessGrant[];
  parties: MatterParty[];
  checklists: MatterChecklist[];
  closure_checklist_completed: boolean;
  accountability_completed: boolean;
  client_delivery_approved: boolean;
  retention_policy_years: number;
  is_fixture?: boolean;
  created_at: string;
  updated_at: string;
}

export type SyncStatus =
  | "ok"
  | "atrasado"
  | "sem_resultado"
  | "parcial"
  | "erro_auth"
  | "rate_limited"
  | "indisponivel"
  | "homologacao"
  | "pendente";

export interface CaseSourceRecord {
  id: string;
  source_name: "datajud" | "djen" | "dje" | "eproc" | "pje" | "esaj" | "manual";
  source_record_id: string;
  tribunal_alias?: string | null;
  degree: string;
  court_organ: string;
  sync_status: SyncStatus;
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  source_updated_at?: string | null;
  last_error_code?: string | null;
}

export interface CaseMovement {
  id: string;
  case_id: string;
  source_name: string;
  external_code?: string | null;
  fingerprint: string;
  occurred_at: string;
  title: string;
  description?: string | null;
  complements: Array<{ name: string; value: string }>;
  received_out_of_order: boolean;
}

export interface CourtCase {
  id: string;
  account_id: string;
  matter_ids: string[];
  cnj_number?: string | null;
  cnj_normalized?: string | null;
  legacy_number?: string | null;
  tribunal_code: string;
  tribunal_alias?: string | null;
  degree: string;
  court_organ: string;
  judicial_system: "datajud" | "eproc" | "pje" | "esaj" | "projudi" | "administrativo" | "manual";
  case_class?: string | null;
  subjects: string[];
  filing_date?: string | null;
  case_status: "ativo" | "suspenso" | "arquivado" | "baixado" | "sobrestado";
  is_sealed: boolean;
  parent_case_id?: string | null;
  relation_type?: "principal" | "incidente" | "recurso" | "cumprimento_sentenca" | "execucao" | "cautelar" | null;
  source_records: CaseSourceRecord[];
  movements: CaseMovement[];
  is_fixture?: boolean;
  created_at: string;
}

export interface LegalCommunication {
  id: string;
  account_id: string;
  matter_id?: string | null;
  case_id?: string | null;
  communication_kind:
    | "movimentacao"
    | "publicacao"
    | "intimacao"
    | "citacao"
    | "ciencia"
    | "evento_interno";
  source_name: "datajud" | "djen" | "dje" | "eproc" | "pje" | "esaj" | "upload_arquivo" | "manual";
  external_identifier?: string | null;
  dedup_hash: string;
  official_link?: string | null;
  available_date?: string | null;
  publication_date?: string | null;
  acknowledgement_date?: string | null;
  collected_at: string;
  received_out_of_order: boolean;
  queue_status: "nova" | "classificada" | "em_revisao" | "vinculada" | "descartada";
  summary: string;
  content_excerpt?: string | null;
  disposition_justification?: string | null;
  reviewed_by_user_id?: string | null;
  reviewed_at?: string | null;
}

export type DeadlineStatus =
  | "sugerido"
  | "em_revisao"
  | "confirmado"
  | "cumprido"
  | "cancelado"
  | "recalculado";

export type ProceduralRegime =
  | "cpc_dias_uteis"
  | "penal_dias_corridos"
  | "trabalhista_clt"
  | "administrativo"
  | "manual";

export interface CalendarException {
  id: string;
  date: string; // YYYY-MM-DD
  end_date?: string | null;
  type:
    | "feriado_nacional"
    | "feriado_estadual"
    | "feriado_municipal"
    | "suspensao_prazos"
    | "recesso_forense"
    | "indisponibilidade_sistema";
  description: string;
  official_act_reference?: string | null;
}

export interface CourtCalendar {
  id: string;
  account_id: string;
  name: string;
  tribunal_code: string;
  locality: string;
  timezone: string;
  is_validated: boolean;
  exceptions: CalendarException[];
}

export interface DeadlineRevision {
  revision_number: number;
  previous_legal_due_date?: string | null;
  new_legal_due_date: string;
  previous_internal_due_date?: string | null;
  new_internal_due_date: string;
  previous_status?: DeadlineStatus | null;
  new_status: DeadlineStatus;
  reason: string;
  changed_by_user_id: string;
  alert_rescheduled: boolean;
  created_at: string;
}

export interface LegalDeadline {
  id: string;
  account_id: string;
  matter_id: string;
  case_id?: string | null;
  communication_id?: string | null;
  calendar_id?: string | null;
  title: string;
  nature: "processual" | "material" | "administrativo" | "contratual" | "interno";
  procedural_regime: ProceduralRegime;
  rule_code: string;
  rule_version: string;
  counting_days: number;
  reference_event: string;
  start_date: string;
  legal_due_date: string;
  internal_due_date: string;
  timezone: string;
  calculation_memory: {
    steps: string[];
    skipped_dates: Array<{ date: string; reason: string }>;
    calendar_validated: boolean;
    warnings: string[];
  };
  requires_manual_review: boolean;
  requires_second_reviewer: boolean;
  status: DeadlineStatus;
  responsible_user_id?: string | null;
  validator_user_id?: string | null;
  second_reviewer_user_id?: string | null;
  validated_at?: string | null;
  evidence_note?: string | null;
  revision_number: number;
  revisions: DeadlineRevision[];
  alert_history: Array<{ id: string; channel: string; scheduled_for: string; status: string }>;
}

export interface LegalHearing {
  id: string;
  account_id: string;
  matter_id: string;
  case_id?: string | null;
  event_type: "audiencia" | "reuniao" | "sustentacao" | "pericia" | "diligencia" | "consulta";
  title: string;
  public_minimal_summary: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  modality: "presencial" | "remota" | "hibrida";
  location_or_link?: string | null;
  participants: string[];
  preparation_notes?: string | null;
  status: "agendada" | "confirmada" | "redesignada" | "realizada" | "ausencia" | "cancelada";
  responsible_user_id?: string | null;
}

export interface LegalTask {
  id: string;
  account_id: string;
  matter_id?: string | null;
  deadline_id?: string | null;
  parent_task_id?: string | null;
  depends_on_task_id?: string | null;
  assigned_user_id?: string | null;
  created_by_user_id?: string | null;
  title: string;
  priority: "baixa" | "media" | "alta" | "urgente";
  status: "a_fazer" | "em_andamento" | "em_revisao" | "concluida" | "cancelada";
  due_date?: string | null;
  estimated_minutes: number;
  logged_minutes: number;
  recurrence_rule?: string | null;
}

export interface ProtocolReceipt {
  id: string;
  account_id: string;
  matter_id: string;
  case_id?: string | null;
  protocol_number: string;
  protocol_type: "peticao" | "recurso" | "manifestacao" | "juntada" | "administrativo" | "cartorio";
  system_name: string;
  filed_at: string;
  filed_by_user_id: string;
  receipt_filename: string;
  receipt_hash: string;
  notes?: string | null;
}

export interface LegalDocumentVersion {
  version_number: number;
  artifact_kind: "original" | "derivado_pdf" | "ocr_pesquisavel" | "comprovante" | "publicado";
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256_hash: string;
  storage_path: string;
  origin_source: string;
  ocr_status: "nao_aplicavel" | "pendente" | "homologacao" | "concluido" | "falhou";
  created_at: string;
}

export interface LegalDocument {
  id: string;
  account_id: string;
  matter_id: string;
  title: string;
  category:
    | "procuracao"
    | "contrato"
    | "peca"
    | "prova"
    | "comprovante"
    | "decisao"
    | "certidao"
    | "parecer"
    | "outros";
  confidentiality_level: ConfidentialityLevel;
  quarantine_status: "quarentena" | "aprovado" | "bloqueado";
  tags: string[];
  retention_until?: string | null;
  portal_published: boolean;
  versions: LegalDocumentVersion[];
  created_at: string;
}

export interface DocumentTemplateField {
  key: string;
  label: string;
  type: "text" | "date" | "currency_cents" | "cpf_cnpj" | "email";
  required: boolean;
}

export interface LegalDocumentTemplate {
  id: string;
  account_id: string;
  name: string;
  template_type:
    | "proposta"
    | "contrato_honorarios"
    | "aditivo"
    | "distrato"
    | "procuracao"
    | "substabelecimento"
    | "autorizacao"
    | "peca";
  practice_area: PracticeArea;
  current_version: number;
  status: "rascunho" | "revisao" | "aprovado" | "arquivado";
  body_template: string;
  typed_fields: DocumentTemplateField[];
  approved_by_user_id?: string | null;
}

export type ContractStatus =
  | "rascunho"
  | "revisao"
  | "aprovado"
  | "enviado"
  | "assinado"
  | "recusado"
  | "expirado"
  | "cancelado";

export interface LegalContract {
  id: string;
  account_id: string;
  matter_id: string;
  parent_contract_id?: string | null;
  contract_number: string;
  title: string;
  contract_kind: "honorarios" | "aditivo" | "distrato" | "procuracao" | "consultoria_recorrente";
  scope_description: string;
  fee_model: "fixo" | "parcelado" | "recorrente" | "exito" | "misto";
  total_value_cents: number;
  installments_count: number;
  success_fee_percent?: number | null;
  success_fee_condition?: string | null;
  success_condition_validated?: boolean;
  signature_method: "eletronica_simples" | "eletronica_avancada" | "icp_brasil" | "manual_comprovado";
  signature_provider: "documenso" | "manual";
  status: ContractStatus;
  receivables_generated: boolean;
  signed_at?: string | null;
  manual_evidence_hash?: string | null;
  manual_evidence_note?: string | null;
  signers: Array<{ name: string; email: string; role: string; signed_at?: string | null }>;
  created_at: string;
}

export interface ClientFundAccount {
  id: string;
  account_id: string;
  name: string;
  account_kind: "escritorio_propria" | "terceiros_clientes" | "custas_reembolsaveis";
  bank_name: string;
  balance_cents: number;
}

export interface Installment {
  id: string;
  receivable_id: string;
  installment_number: number;
  due_date: string;
  amount_cents: number;
  paid_cents: number;
  status: "aberto" | "parcial" | "pago" | "estornado" | "cancelado" | "atrasado";
  billing_provider: "manual" | "pix_adapter" | "boleto_adapter";
  nfse_status: "nao_emitida" | "homologacao" | "emitida" | "cancelada";
}

export interface Receivable {
  id: string;
  account_id: string;
  matter_id: string;
  contract_id?: string | null;
  fund_account_id: string;
  revenue_class: "receita_propria" | "valor_terceiros" | "credito_a_receber" | "reembolso_custas";
  description: string;
  total_cents: number;
  discount_cents: number;
  paid_cents: number;
  status: "aberto" | "parcial" | "pago" | "estornado" | "cancelado" | "inadimplente";
  competence_month: string;
  idempotency_key?: string | null;
  installments: Installment[];
}

export interface LegalExpense {
  id: string;
  account_id: string;
  matter_id?: string | null;
  fund_account_id: string;
  expense_kind:
    | "despesa_escritorio"
    | "custa_processual"
    | "reembolso_cliente"
    | "repasse_terceiro"
    | "correspondente";
  cost_center: string;
  description: string;
  amount_cents: number;
  due_date: string;
  status: "aberto" | "pago" | "reembolsado" | "estornado" | "cancelado";
}

export interface PaymentRecord {
  id: string;
  account_id: string;
  fund_account_id: string;
  direction: "entrada" | "saida";
  payment_method: "manual" | "pix" | "boleto" | "ted" | "cartao" | "alvara";
  amount_cents: number;
  paid_at: string;
  status: "pendente" | "confirmado" | "estornado" | "cancelado";
  idempotency_key?: string | null;
  reconciliation_status: "pendente" | "conciliado" | "divergente";
  installment_id?: string | null;
  reversal_reason?: string | null;
}

export interface PortalInvitation {
  id: string;
  account_id: string;
  matter_id: string;
  entity_id: string;
  entity_name: string;
  token: string;
  scope_role: "cliente" | "representante";
  is_revoked: boolean;
  revoked_at?: string | null;
  expires_at: string;
}

export interface PortalPublication {
  id: string;
  account_id: string;
  matter_id: string;
  publication_type:
    | "andamento"
    | "pendencia"
    | "documento"
    | "agenda"
    | "contrato"
    | "cobranca"
    | "mensagem";
  title: string;
  body: string;
  contains_sensitive_info: boolean;
  approved_by_user_id?: string | null;
  published_at?: string | null;
  revoked_at?: string | null;
  client_acknowledged_at?: string | null;
}

export interface AuditEvent {
  id: string;
  account_id: string;
  actor_user_id: string;
  actor_role: string;
  operation: string;
  resource_type: string;
  resource_id?: string | null;
  outcome: "allowed" | "denied" | "failed";
  reason?: string | null;
  correlation_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface IntegrationStatus {
  provider:
    | "datajud"
    | "djen"
    | "dje"
    | "eproc"
    | "pje"
    | "esaj"
    | "documenso"
    | "gotenberg"
    | "ocrmypdf"
    | "pix_boleto"
    | "nfse"
    | "ai_assist";
  label: string;
  mode: "indisponivel" | "homologacao" | "producao";
  status: "nao_configurado" | "ativo" | "erro_auth" | "rate_limited" | "indisponivel";
  allow_auto_acknowledgement: boolean;
  manual_fallback_available: boolean;
  last_health_check_at?: string | null;
  note: string;
}

export interface DataSubjectRequest {
  id: string;
  account_id: string;
  requester_name: string;
  requester_document_masked: string;
  request_type: "acesso" | "correcao" | "anonimizacao" | "eliminacao" | "portabilidade" | "revogacao";
  status:
    | "aberto"
    | "verificando_identidade"
    | "em_analise_sigilo"
    | "atendido"
    | "parcialmente_atendido"
    | "indeferido";
  identity_verified: boolean;
  third_party_secrecy_reviewed: boolean;
  retention_blocked: boolean;
  due_date: string;
  justification?: string | null;
}
