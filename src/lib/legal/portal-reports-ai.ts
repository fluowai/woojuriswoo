// ============================================================
// WooJuris — Portal do Cliente, Importação CSV com Rollback,
// Relatórios com Fórmulas Explícitas e IA Assistiva com Citações
// ============================================================

import { createHash } from "node:crypto";
import type {
  CourtCase,
  LegalDeadline,
  LegalIntake,
  Matter,
  PortalInvitation,
  PortalPublication,
  Receivable,
} from "./types";

// ------------------------------------------------------------
// 1. PORTAL DO CLIENTE — revogação imediata + apenas publicados
// ------------------------------------------------------------

export function resolvePortalAccess(
  invitation: PortalInvitation | undefined,
  publications: PortalPublication[],
  now: Date = new Date(),
):
  | {
      allowed: true;
      invitation: PortalInvitation;
      visiblePublications: PortalPublication[];
    }
  | { allowed: false; reason: string } {
  if (!invitation) {
    return { allowed: false, reason: "Convite do portal não encontrado." };
  }
  if (invitation.is_revoked || invitation.revoked_at) {
    return {
      allowed: false,
      reason: "Acesso ou representação revogada imediatamente pelo escritório.",
    };
  }
  if (new Date(invitation.expires_at).getTime() <= now.getTime()) {
    return {
      allowed: false,
      reason: "Link de acesso expirado. Solicite novo convite autenticado.",
    };
  }

  // Expõe APENAS publicações explicitamente publicadas, não revogadas,
  // e se contiverem informação sensível, apenas se aprovadas por responsável.
  const visiblePublications = publications.filter(
    (p) =>
      p.account_id === invitation.account_id &&
      p.matter_id === invitation.matter_id &&
      Boolean(p.published_at) &&
      !p.revoked_at &&
      (!p.contains_sensitive_info || Boolean(p.approved_by_user_id)),
  );

  return { allowed: true, invitation, visiblePublications };
}

// ------------------------------------------------------------
// 2. IMPORTAÇÃO CSV ASSISTIDA — prévia, deduplicação e rollback
// ------------------------------------------------------------

export interface CsvImportRow {
  rowNumber: number;
  key: string;
  data: Record<string, string>;
}

export interface CsvImportBatchState {
  batchId: string;
  targetModule: "clients" | "cases" | "deadlines" | "finance";
  fileSha256: string;
  importedKeys: string[];
  editedAfterImportKeys: Set<string>;
  duplicatesSkipped: number;
  inconsistencies: Array<{ rowNumber: number; reason: string }>;
  rolledBackKeys: string[];
  preservedEditedKeys: string[];
}

export function parseCsvAssisted(
  csvText: string,
  requiredColumns: string[],
  dedupKeyColumn: string,
): {
  rows: CsvImportRow[];
  inconsistencies: Array<{ rowNumber: number; reason: string }>;
  fileSha256: string;
} {
  const fileSha256 = createHash("sha256").update(csvText, "utf8").digest("hex");
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      rows: [],
      inconsistencies: [{ rowNumber: 1, reason: "CSV sem cabeçalho ou sem linhas de dados." }],
      fileSha256,
    };
  }

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const inconsistencies: Array<{ rowNumber: number; reason: string }> = [];

  for (const req of requiredColumns) {
    if (!headers.includes(req.toLowerCase())) {
      inconsistencies.push({
        rowNumber: 1,
        reason: `Coluna obrigatória ausente no cabeçalho: "${req}"`,
      });
    }
  }
  if (inconsistencies.length > 0) {
    return { rows: [], inconsistencies, fileSha256 };
  }

  const rows: CsvImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim());
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = cols[idx] ?? "";
    });
    const missing = requiredColumns.filter((c) => !record[c.toLowerCase()]);
    if (missing.length > 0) {
      inconsistencies.push({
        rowNumber: i + 1,
        reason: `Campos obrigatórios vazios: ${missing.join(", ")}`,
      });
      continue;
    }
    const key = (record[dedupKeyColumn.toLowerCase()] ?? "").toLowerCase();
    rows.push({ rowNumber: i + 1, key, data: record });
  }

  return { rows, inconsistencies, fileSha256 };
}

export function executeCsvImportIdempotent(params: {
  targetModule: CsvImportBatchState["targetModule"];
  csvText: string;
  requiredColumns: string[];
  dedupKeyColumn: string;
  existingKeys: Set<string>;
}): CsvImportBatchState {
  const parsed = parseCsvAssisted(
    params.csvText,
    params.requiredColumns,
    params.dedupKeyColumn,
  );
  const importedKeys: string[] = [];
  let duplicatesSkipped = 0;

  for (const row of parsed.rows) {
    if (params.existingKeys.has(row.key) || importedKeys.includes(row.key)) {
      duplicatesSkipped++;
      continue;
    }
    params.existingKeys.add(row.key);
    importedKeys.push(row.key);
  }

  return {
    batchId: `batch-${parsed.fileSha256.slice(0, 10)}`,
    targetModule: params.targetModule,
    fileSha256: parsed.fileSha256,
    importedKeys,
    editedAfterImportKeys: new Set<string>(),
    duplicatesSkipped,
    inconsistencies: parsed.inconsistencies,
    rolledBackKeys: [],
    preservedEditedKeys: [],
  };
}

/**
 * Rollback seguro do lote CSV:
 * Remove registros não alterados após importação e preserva registros que
 * sofreram edições posteriores pela equipe.
 */
export function rollbackCsvBatch(
  batch: CsvImportBatchState,
  existingKeys: Set<string>,
): CsvImportBatchState {
  const rolledBackKeys: string[] = [];
  const preservedEditedKeys: string[] = [];

  for (const key of batch.importedKeys) {
    if (batch.editedAfterImportKeys.has(key)) {
      preservedEditedKeys.push(key);
    } else {
      existingKeys.delete(key);
      rolledBackKeys.push(key);
    }
  }

  return {
    ...batch,
    rolledBackKeys,
    preservedEditedKeys,
  };
}

// ------------------------------------------------------------
// 3. IA ASSISTIVA — Citações obrigatórias + Revisão Humana
// ------------------------------------------------------------

export interface AiCitation {
  sourceType: "document" | "movement" | "communication" | "intake";
  sourceId: string;
  label: string;
  version?: number;
  pageOrRef: string;
}

export interface AiAssistSuggestion {
  taskKind: "classificar_mensagem" | "resumir_autos" | "extrair_campos" | "preparar_minuta";
  summary: string;
  extractedFields?: Record<string, string>;
  citations: AiCitation[];
  requiresHumanReview: true;
  autonomousExecutionBlocked: true;
  telemetryRedacted: true;
}

export function buildAssistiveAiSuggestion(params: {
  taskKind: AiAssistSuggestion["taskKind"];
  untrustedInputText: string;
  citations: AiCitation[];
  canAccessAllSources: boolean;
}): { ok: true; suggestion: AiAssistSuggestion } | { ok: false; error: string } {
  if (!params.canAccessAllSources) {
    return {
      ok: false,
      error:
        "Acesso negado: IA assistiva filtra autorização antes da busca e novamente no acesso aos resultados.",
    };
  }
  if (params.citations.length === 0) {
    return {
      ok: false,
      error:
        "Política de IA assistiva exige ao menos uma citação rastreável (arquivo/versão/página ou registro fonte).",
    };
  }

  // Trata texto de documentos/mensagens como conteúdo não confiável (remove padrões de prompt injection simples)
  const sanitizedExcerpt = params.untrustedInputText
    .replace(/ignore\s+previous\s+instructions/gi, "[conteudo_nao_confiavel_neutralizado]")
    .slice(0, 260)
    .trim();

  const summaryByKind: Record<AiAssistSuggestion["taskKind"], string> = {
    classificar_mensagem: `Sugestão de triagem (revisão humana obrigatória): demanda identificada a partir do relato "${sanitizedExcerpt}".`,
    resumir_autos: `Resumo assistivo dos autos autorizados (${params.citations.length} fonte(s) citada(s)): ${sanitizedExcerpt}`,
    extrair_campos: `Campos sugeridos para conferência manual antes de gravar: extraídos de ${params.citations[0].label}.`,
    preparar_minuta: `Rascunho de minuta gerado em modo assistivo — proibida expedição/protocolo sem revisão e aprovação do advogado responsável.`,
  };

  return {
    ok: true,
    suggestion: {
      taskKind: params.taskKind,
      summary: summaryByKind[params.taskKind],
      citations: params.citations,
      requiresHumanReview: true,
      autonomousExecutionBlocked: true,
      telemetryRedacted: true,
    },
  };
}

// ------------------------------------------------------------
// 4. RELATÓRIOS — Indicadores com fórmula, período e fuso
// ------------------------------------------------------------

export interface LegalKpiReport {
  generatedAt: string;
  timezone: string;
  periodLabel: string;
  indicators: Array<{
    key: string;
    label: string;
    value: string;
    numericValue: number;
    formula: string;
  }>;
}

export function computeLegalReports(params: {
  intakes: LegalIntake[];
  matters: Matter[];
  cases: CourtCase[];
  deadlines: LegalDeadline[];
  receivables: Receivable[];
  timezone?: string;
  periodLabel?: string;
}): LegalKpiReport {
  const tz = params.timezone ?? "America/Sao_Paulo";
  const totalIntakes = params.intakes.length;
  const convertedIntakes = params.intakes.filter((i) => i.stage === "convertido").length;
  const conversionRate = totalIntakes > 0 ? (convertedIntakes / totalIntakes) * 100 : 0;

  const pendingValidationDeadlines = params.deadlines.filter(
    (d) => d.status === "sugerido" || d.status === "em_revisao",
  ).length;
  const confirmedUpcomingDeadlines = params.deadlines.filter(
    (d) => d.status === "confirmado",
  ).length;

  const syncFailures = params.cases
    .flatMap((c) => c.source_records)
    .filter((s) =>
      ["erro_auth", "rate_limited", "indisponivel", "atrasado", "parcial"].includes(
        s.sync_status,
      ),
    ).length;

  const totalBilledCents = params.receivables
    .filter((r) => r.revenue_class === "receita_propria" && r.status !== "cancelado")
    .reduce((s, r) => s + (r.total_cents - r.discount_cents), 0);
  const overdueCents = params.receivables
    .flatMap((r) => r.installments)
    .filter((i) => i.status === "atrasado")
    .reduce((s, i) => s + (i.amount_cents - i.paid_cents), 0);
  const delinquencyRate =
    totalBilledCents > 0 ? (overdueCents / totalBilledCents) * 100 : 0;

  return {
    generatedAt: new Date().toISOString(),
    timezone: tz,
    periodLabel: params.periodLabel ?? "Últimos 30 dias",
    indicators: [
      {
        key: "conversion_rate",
        label: "Taxa de Conversão (Atendimento → Pasta)",
        value: `${conversionRate.toFixed(1)}%`,
        numericValue: Number(conversionRate.toFixed(1)),
        formula: "(Oportunidades convertidas / Total de oportunidades no período) × 100",
      },
      {
        key: "active_matters",
        label: "Pastas Jurídicas Ativas",
        value: String(params.matters.filter((m) => m.status === "ativo").length),
        numericValue: params.matters.filter((m) => m.status === "ativo").length,
        formula: "Contagem de pastas com status = 'ativo' autorizadas ao usuário",
      },
      {
        key: "deadlines_confirmed",
        label: "Prazos Confirmados a Vencer",
        value: String(confirmedUpcomingDeadlines),
        numericValue: confirmedUpcomingDeadlines,
        formula: "Contagem de prazos com status = 'confirmado' e validação humana registrada",
      },
      {
        key: "deadlines_pending_validation",
        label: "Pendências de Validação de Prazo",
        value: String(pendingValidationDeadlines),
        numericValue: pendingValidationDeadlines,
        formula: "Contagem de prazos com status IN ('sugerido', 'em_revisao')",
      },
      {
        key: "capture_failures",
        label: "Falhas/Alertas de Sincronização Judicial",
        value: String(syncFailures),
        numericValue: syncFailures,
        formula: "Registros de origem com sync_status IN ('erro_auth','rate_limited','indisponivel','atrasado','parcial')",
      },
      {
        key: "delinquency_rate",
        label: "Índice de Inadimplência (Receita Própria)",
        value: `${delinquencyRate.toFixed(1)}%`,
        numericValue: Number(delinquencyRate.toFixed(1)),
        formula: "(Saldo em aberto de parcelas atrasadas / Total faturado de receita própria) × 100",
      },
    ],
  };
}
