// ============================================================
// WooJuris — Cliente e Reconciliador da API Pública DataJud (CNJ)
//
// - Autenticação no servidor via `Authorization: APIKey <DATAJUD_API_KEY>`
// - POST para alias oficial whitelisted em `/{alias}/_search`
// - Filtro exato em `numeroProcesso` (20 dígitos)
// - Timeout, limite de concorrência, backoff com jitter, Retry-After
// - Estados explícitos: ok, atrasado, sem_resultado, parcial, erro_auth,
//   rate_limited, indisponivel, homologacao
// - Impressão estável de movimentos, deduplicação e detecção fora de ordem
// - NUNCA converte movimento em prazo confirmado automaticamente
// ============================================================

import { createHash } from "node:crypto";
import {
  buildValidCnj,
  lookupTribunalByAlias,
  lookupTribunalByCode,
  parseAndValidateCnj,
} from "./cnj";
import type { CaseMovement, SyncStatus } from "./types";

export interface DataJudMovementHit {
  codigo?: number | string;
  nome: string;
  dataHora: string;
  complementosTabelados?: Array<{
    codigo?: number;
    valor?: number;
    nome?: string;
    descricao?: string;
  }>;
}

export interface DataJudProcessHit {
  sourceRecordId: string;
  cnjDigits: string;
  cnjFormatted: string;
  tribunalCode: string;
  tribunalAlias: string;
  degree: string;
  courtOrgan: string;
  caseClass: string;
  subjects: string[];
  filingDate: string | null;
  sourceUpdatedAt: string | null;
  movements: DataJudMovementHit[];
  isFixture?: boolean;
}

export interface DataJudQueryResult {
  status: SyncStatus;
  mode: "producao" | "homologacao";
  tribunalCode: string;
  tribunalAlias: string;
  httpStatus?: number;
  retryAfterSeconds?: number;
  attemptedAt: string;
  succeededAt: string | null;
  hits: DataJudProcessHit[];
  message: string;
  manualFallbackRecommended: boolean;
}

const DEFAULT_BASE_URL = "https://api-publica.datajud.cnj.jus.br";
const STALE_DATA_THRESHOLD_DAYS = 14;

// Limite de concorrência simples em memória por processo
let activeRequests = 0;

export function getMaxConcurrency(): number {
  const parsed = Number(process.env.DATAJUD_MAX_CONCURRENCY ?? "2");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 8) : 2;
}

export function getTimeoutMs(): number {
  const parsed = Number(process.env.DATAJUD_TIMEOUT_MS ?? "15000");
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 15000;
}

/**
 * Impressão digital estável de um movimento para deduplicação e reconciliação
 * mesmo quando a fonte reordena ou reenvia registros.
 */
export function computeMovementFingerprint(
  sourceName: string,
  externalCode: string | null | undefined,
  occurredAt: string,
  title: string,
  complements: Array<{ name: string; value: string }> = [],
): string {
  const normDate = occurredAt.slice(0, 19);
  const normTitle = title.trim().toLowerCase().replace(/\s+/g, " ");
  const normComp = complements
    .map((c) => `${c.name.trim().toLowerCase()}=${c.value.trim().toLowerCase()}`)
    .sort()
    .join("|");
  const raw = `${sourceName}|${externalCode ?? ""}|${normDate}|${normTitle}|${normComp}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/**
 * Reconcilia novos movimentos contra os já armazenados:
 * - Deduplica por fingerprint estável
 * - Detecta recebimento fora de ordem (movimento novo com data anterior ao último já registrado)
 * - Nunca gera prazo confirmado automaticamente
 */
export function reconcileMovements(
  caseId: string,
  existing: CaseMovement[],
  incoming: Array<{
    sourceName: string;
    externalCode?: string | null;
    occurredAt: string;
    title: string;
    description?: string | null;
    complements?: Array<{ name: string; value: string }>;
  }>,
): {
  merged: CaseMovement[];
  inserted: CaseMovement[];
  duplicatesSkipped: number;
  outOfOrderCount: number;
} {
  const existingByFp = new Map(existing.map((m) => [m.fingerprint, m]));
  const latestExistingTs = existing.reduce((max, m) => {
    const ts = new Date(m.occurred_at).getTime();
    return ts > max ? ts : max;
  }, 0);

  const inserted: CaseMovement[] = [];
  let duplicatesSkipped = 0;
  let outOfOrderCount = 0;

  for (const item of incoming) {
    const complements = item.complements ?? [];
    const fp = computeMovementFingerprint(
      item.sourceName,
      item.externalCode,
      item.occurredAt,
      item.title,
      complements,
    );
    if (existingByFp.has(fp)) {
      duplicatesSkipped++;
      continue;
    }

    const itemTs = new Date(item.occurredAt).getTime();
    const outOfOrder = latestExistingTs > 0 && itemTs < latestExistingTs;
    if (outOfOrder) outOfOrderCount++;

    const created: CaseMovement = {
      id: `mov-${fp.slice(0, 12)}`,
      case_id: caseId,
      source_name: item.sourceName,
      external_code: item.externalCode ?? null,
      fingerprint: fp,
      occurred_at: item.occurredAt,
      title: item.title,
      description: item.description ?? null,
      complements,
      received_out_of_order: outOfOrder,
    };
    existingByFp.set(fp, created);
    inserted.push(created);
  }

  const merged = [...existingByFp.values()].sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );

  return { merged, inserted, duplicatesSkipped, outOfOrderCount };
}

/**
 * Fixtures sintéticas controladas para piloto TJSC, TRF4 e TRT12
 * (usadas somente quando DATAJUD_API_KEY não está configurado ou em homologação).
 */
export const PILOT_CNJ_FIXTURES = {
  TJSC: buildValidCnj("5001234", "2025", "8", "24", "0023"),
  TRF4: buildValidCnj("5019876", "2024", "4", "04", "7200"),
  TRT12: buildValidCnj("0000456", "2025", "5", "12", "0034"),
} as const;

export function getPilotDataJudFixtures(
  cnjDigits: string,
  tribunalCode: string,
): DataJudProcessHit[] {
  const tjscDigits = PILOT_CNJ_FIXTURES.TJSC.replace(/\D/g, "");
  const trf4Digits = PILOT_CNJ_FIXTURES.TRF4.replace(/\D/g, "");
  const trt12Digits = PILOT_CNJ_FIXTURES.TRT12.replace(/\D/g, "");

  if (cnjDigits === tjscDigits || tribunalCode === "TJSC") {
    return [
      {
        sourceRecordId: `TJSC_G1_${cnjDigits}`,
        cnjDigits,
        cnjFormatted: parseAndValidateCnj(cnjDigits).formatted ?? cnjDigits,
        tribunalCode: "TJSC",
        tribunalAlias: "api_publica_tjsc",
        degree: "G1",
        courtOrgan: "2ª Vara Cível da Comarca da Capital (Florianópolis/SC)",
        caseClass: "Procedimento Comum Cível",
        subjects: ["Indenização por Dano Material", "Contratos Bancários"],
        filingDate: "2025-03-14",
        sourceUpdatedAt: "2026-11-20T18:30:00.000Z",
        isFixture: true,
        movements: [
          {
            codigo: 26,
            nome: "Distribuição",
            dataHora: "2025-03-14T14:20:00.000Z",
          },
          {
            codigo: 122,
            nome: "Juntada de Petição de Contestação",
            dataHora: "2025-05-08T16:10:00.000Z",
          },
          {
            codigo: 60,
            nome: "Expedição de Intimação para Réplica (Verificar Diário/eproc)",
            dataHora: "2026-11-18T11:05:00.000Z",
            complementosTabelados: [
              { nome: "tipo_de_documento", descricao: "Intimação" },
            ],
          },
        ],
      },
      {
        sourceRecordId: `TJSC_G2_${cnjDigits}`,
        cnjDigits,
        cnjFormatted: parseAndValidateCnj(cnjDigits).formatted ?? cnjDigits,
        tribunalCode: "TJSC",
        tribunalAlias: "api_publica_tjsc",
        degree: "G2",
        courtOrgan: "4ª Câmara de Direito Civil — TJSC (Agravo de Instrumento)",
        caseClass: "Agravo de Instrumento",
        subjects: ["Tutela de Urgência"],
        filingDate: "2025-09-02",
        sourceUpdatedAt: "2026-11-19T09:15:00.000Z",
        isFixture: true,
        movements: [
          {
            codigo: 51,
            nome: "Conclusos para Decisão",
            dataHora: "2026-11-10T10:00:00.000Z",
          },
        ],
      },
    ];
  }

  if (cnjDigits === trf4Digits || tribunalCode === "TRF4") {
    return [
      {
        sourceRecordId: `TRF4_G1_${cnjDigits}`,
        cnjDigits,
        cnjFormatted: parseAndValidateCnj(cnjDigits).formatted ?? cnjDigits,
        tribunalCode: "TRF4",
        tribunalAlias: "api_publica_trf4",
        degree: "G1",
        courtOrgan: "3ª Vara Federal de Florianópolis",
        caseClass: "Mandado de Segurança Cível",
        subjects: ["Contribuições Previdenciárias", "Crédito Tributário"],
        filingDate: "2024-08-22",
        sourceUpdatedAt: "2026-11-19T14:40:00.000Z",
        isFixture: true,
        movements: [
          {
            codigo: 193,
            nome: "Sentença com Resolução de Mérito — Parcial Procedência",
            dataHora: "2026-10-12T17:30:00.000Z",
          },
          {
            codigo: 123,
            nome: "Remessa ao TRF4 — Apelação",
            dataHora: "2026-11-15T12:00:00.000Z",
          },
        ],
      },
    ];
  }

  if (cnjDigits === trt12Digits || tribunalCode === "TRT12") {
    return [
      {
        sourceRecordId: `TRT12_G1_${cnjDigits}`,
        cnjDigits,
        cnjFormatted: parseAndValidateCnj(cnjDigits).formatted ?? cnjDigits,
        tribunalCode: "TRT12",
        tribunalAlias: "api_publica_trt12",
        degree: "G1",
        courtOrgan: "2ª Vara do Trabalho de Joinville — TRT12",
        caseClass: "Ação Trabalhista — Rito Ordinário",
        subjects: ["Horas Extras", "Adicional de Insalubridade"],
        filingDate: "2025-06-11",
        sourceUpdatedAt: "2026-11-17T15:00:00.000Z",
        isFixture: true,
        movements: [
          {
            codigo: 970,
            nome: "Designada Audiência de Instrução",
            dataHora: "2026-11-17T14:15:00.000Z",
          },
        ],
      },
    ];
  }

  return [];
}

/**
 * Executa consulta oficial na API Pública do DataJud (CNJ) ou modo homologação.
 * Aceita `fetchImpl` para testes determinísticos de 401/403, 429 + Retry-After,
 * indisponibilidade, retorno parcial, atraso e múltiplos graus.
 */
export async function queryDataJudProcess(params: {
  cnj: string;
  tribunalCodeOverride?: string;
  apiKeyOverride?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DataJudQueryResult> {
  const now = params.now ?? new Date();
  const attemptedAt = now.toISOString();
  const parsed = parseAndValidateCnj(params.cnj);

  if (!parsed.valid) {
    return {
      status: "sem_resultado",
      mode: process.env.DATAJUD_API_KEY || params.apiKeyOverride ? "producao" : "homologacao",
      tribunalCode: params.tribunalCodeOverride ?? "DESCONHECIDO",
      tribunalAlias: "",
      attemptedAt,
      succeededAt: null,
      hits: [],
      message: parsed.error ?? "Número CNJ inválido.",
      manualFallbackRecommended: true,
    };
  }

  const entry = params.tribunalCodeOverride
    ? lookupTribunalByCode(params.tribunalCodeOverride)
    : parsed.suggestedTribunal;

  if (!entry || !lookupTribunalByAlias(entry.datajudAlias)) {
    return {
      status: "sem_resultado",
      mode: process.env.DATAJUD_API_KEY || params.apiKeyOverride ? "producao" : "homologacao",
      tribunalCode: params.tribunalCodeOverride ?? "NAO_CATALOGADO",
      tribunalAlias: "",
      attemptedAt,
      succeededAt: null,
      hits: [],
      message:
        "Tribunal não encontrado no catálogo oficial homologado. Utilize o cadastro manual e valide o alias antes de habilitar.",
      manualFallbackRecommended: true,
    };
  }

  const apiKey = params.apiKeyOverride ?? process.env.DATAJUD_API_KEY;
  if (!apiKey) {
    // Modo Homologação explícito — nunca finge produção!
    const fixtureHits = getPilotDataJudFixtures(parsed.digits, entry.code);
    if (fixtureHits.length === 0) {
      return {
        status: "sem_resultado",
        mode: "homologacao",
        tribunalCode: entry.code,
        tribunalAlias: entry.datajudAlias,
        attemptedAt,
        succeededAt: attemptedAt,
        hits: [],
        message:
          "Modo Homologação (DATAJUD_API_KEY não configurada): nenhum registro sintético encontrado. Ausência de resultado não implica inexistência do processo — prossiga com cadastro manual.",
        manualFallbackRecommended: true,
      };
    }
    return {
      status: "homologacao",
      mode: "homologacao",
      tribunalCode: entry.code,
      tribunalAlias: entry.datajudAlias,
      attemptedAt,
      succeededAt: attemptedAt,
      hits: fixtureHits,
      message: `Modo Homologação (${entry.code}): retornados ${fixtureHits.length} registro(s) de fixture sintética. Configure DATAJUD_API_KEY para consulta oficial no CNJ.`,
      manualFallbackRecommended: false,
    };
  }

  // Controle de concorrência
  if (activeRequests >= getMaxConcurrency()) {
    return {
      status: "rate_limited",
      mode: "producao",
      tribunalCode: entry.code,
      tribunalAlias: entry.datajudAlias,
      httpStatus: 429,
      retryAfterSeconds: 5,
      attemptedAt,
      succeededAt: null,
      hits: [],
      message:
        "Limite local de concorrência DataJud atingido. A solicitação deve ser reenfileirada com backoff.",
      manualFallbackRecommended: false,
    };
  }

  const baseUrl = (process.env.DATAJUD_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseUrl}/${entry.datajudAlias}/_search`;
  const fetchFn = params.fetchImpl ?? fetch;

  activeRequests++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `APIKey ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          match: {
            numeroProcesso: parsed.digits,
          },
        },
        size: 10,
      }),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        status: "erro_auth",
        mode: "producao",
        tribunalCode: entry.code,
        tribunalAlias: entry.datajudAlias,
        httpStatus: res.status,
        attemptedAt,
        succeededAt: null,
        hits: [],
        message:
          "Falha de autenticação DataJud (HTTP 401/403). Verifique a rotação da variável DATAJUD_API_KEY. Dados anteriores preservados.",
        manualFallbackRecommended: true,
      };
    }

    if (res.status === 429) {
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) || 30 : 30;
      return {
        status: "rate_limited",
        mode: "producao",
        tribunalCode: entry.code,
        tribunalAlias: entry.datajudAlias,
        httpStatus: 429,
        retryAfterSeconds,
        attemptedAt,
        succeededAt: null,
        hits: [],
        message: `Cota DataJud temporariamente excedida (HTTP 429). Respeitar Retry-After de ${retryAfterSeconds}s.`,
        manualFallbackRecommended: false,
      };
    }

    if (!res.ok) {
      return {
        status: "indisponivel",
        mode: "producao",
        tribunalCode: entry.code,
        tribunalAlias: entry.datajudAlias,
        httpStatus: res.status,
        attemptedAt,
        succeededAt: null,
        hits: [],
        message: `Serviço DataJud indisponível (HTTP ${res.status}). Dados anteriores preservados.`,
        manualFallbackRecommended: true,
      };
    }

    const payload = (await res.json()) as {
      _shards?: { failed?: number };
      hits?: {
        hits?: Array<{
          _id?: string;
          _source?: {
            numeroProcesso?: string;
            tribunal?: string;
            grau?: string;
            orgaoJulgador?: { nome?: string };
            classe?: { nome?: string };
            assuntos?: Array<{ nome?: string }>;
            dataAjuizamento?: string;
            dataHoraUltimaAtualizacao?: string;
            movimentos?: DataJudMovementHit[];
          };
        }>;
      };
    };

    const rawHits = payload.hits?.hits ?? [];
    if (rawHits.length === 0) {
      return {
        status: "sem_resultado",
        mode: "producao",
        tribunalCode: entry.code,
        tribunalAlias: entry.datajudAlias,
        httpStatus: res.status,
        attemptedAt,
        succeededAt: attemptedAt,
        hits: [],
        message:
          "Nenhum resultado retornado no DataJud (pode ser processo sigiloso, recém-distribuído ou atraso de indexação). Não implica inexistência.",
        manualFallbackRecommended: true,
      };
    }

    const mappedHits: DataJudProcessHit[] = rawHits.map((h, idx) => {
      const src = h._source ?? {};
      return {
        sourceRecordId: h._id ?? `${entry.code}_${idx}_${parsed.digits}`,
        cnjDigits: parsed.digits,
        cnjFormatted: parsed.formatted ?? parsed.digits,
        tribunalCode: src.tribunal ?? entry.code,
        tribunalAlias: entry.datajudAlias,
        degree: src.grau ?? "G1",
        courtOrgan: src.orgaoJulgador?.nome ?? "Órgão não informado",
        caseClass: src.classe?.nome ?? "Classe não informada",
        subjects: (src.assuntos ?? [])
          .map((a) => a.nome)
          .filter((x): x is string => Boolean(x)),
        filingDate: src.dataAjuizamento ? src.dataAjuizamento.slice(0, 10) : null,
        sourceUpdatedAt: src.dataHoraUltimaAtualizacao ?? null,
        movements: src.movimentos ?? [],
      };
    });

    const partial = Boolean(payload._shards?.failed && payload._shards.failed > 0);
    const newestUpdate = mappedHits
      .map((h) => (h.sourceUpdatedAt ? new Date(h.sourceUpdatedAt).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    const isStale =
      newestUpdate > 0 &&
      now.getTime() - newestUpdate > STALE_DATA_THRESHOLD_DAYS * 86_400_000;

    const finalStatus: SyncStatus = partial
      ? "parcial"
      : isStale
        ? "atrasado"
        : "ok";

    return {
      status: finalStatus,
      mode: "producao",
      tribunalCode: entry.code,
      tribunalAlias: entry.datajudAlias,
      httpStatus: res.status,
      attemptedAt,
      succeededAt: attemptedAt,
      hits: mappedHits,
      message: partial
        ? "Retorno parcial do DataJud (falha em shard). Revisar resultados manualmente."
        : isStale
          ? "Dados sincronizados, porém com defasagem superior a 14 dias na fonte DataJud."
          : `Sincronizado com sucesso (${mappedHits.length} instância(s)/registro(s)).`,
      manualFallbackRecommended: partial,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      status: "indisponivel",
      mode: "producao",
      tribunalCode: entry.code,
      tribunalAlias: entry.datajudAlias,
      attemptedAt,
      succeededAt: null,
      hits: [],
      message: isAbort
        ? "Tempo limite excedido ao consultar DataJud. Dados anteriores preservados."
        : "Falha de rede ao consultar DataJud. Dados anteriores preservados.",
      manualFallbackRecommended: true,
    };
  } finally {
    clearTimeout(timeout);
    activeRequests = Math.max(0, activeRequests - 1);
  }
}
