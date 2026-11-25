// ============================================================
// WooJuris — Motor de Verificação de Conflitos de Interesses
//
// 1. Pesquisa primeiro por identificadores exatos (CPF/CNPJ/OAB).
// 2. Depois por nome normalizado, aliases, grupo econômico,
//    partes adversas e similaridade textual.
// 3. Retorna SINAL MÍNIMO quando a origem está sob sigilo.
// 4. Bloqueia contratação quando política exige decisão pendente.
// ============================================================

import type {
  ConflictCandidate,
  ConflictCheck,
  Matter,
  PersonEntity,
} from "./types";

export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDocumentId(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

/**
 * Similaridade combinada (tokens Jaccard + Levenshtein normalizado)
 * para capturar variações ortográficas e nomes abreviados.
 */
export function computeNameSimilarity(aRaw: string, bRaw: string): number {
  const a = normalizeText(aRaw);
  const b = normalizeText(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;

  // Token overlap (Jaccard)
  const tokensA = new Set(a.split(" ").filter((t) => t.length > 2));
  const tokensB = new Set(b.split(" ").filter((t) => t.length > 2));
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // Levenshtein distance
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  const levSim = 1 - dp[m][n] / Math.max(m, n);

  // Substring bonus for corporate names (e.g. "Alfa" in "Construtora Alfa Ltda")
  const containsBonus = a.includes(b) || b.includes(a) ? 0.85 : 0;

  return Number(Math.max(jaccard, levSim, containsBonus).toFixed(4));
}

export interface ConflictSearchInput {
  accountId: string;
  queryName: string;
  queryDocument?: string | null;
  queryAliases?: string[];
  queryEconomicGroup?: string | null;
  triggerReason?: ConflictCheck["trigger_reason"];
  intakeId?: string | null;
  matterId?: string | null;
  requestedByUserId?: string | null;
}

export interface ConflictEvaluationOutput {
  candidates: ConflictCandidate[];
  recommendedStatus: ConflictCheck["status"];
  blocksHiring: boolean;
}

export function runConflictSearch(
  input: ConflictSearchInput,
  entities: PersonEntity[],
  matters: Matter[],
  policyBlockHiring: boolean = true,
): ConflictEvaluationOutput {
  const scopedEntities = entities.filter(
    (e) => e.account_id === input.accountId && !e.merged_into_id,
  );
  const scopedMatters = matters.filter((m) => m.account_id === input.accountId);

  const normQueryDoc = normalizeDocumentId(input.queryDocument);
  const normQueryName = normalizeText(input.queryName);
  const normQueryGroup = normalizeText(input.queryEconomicGroup);
  const normQueryAliases = (input.queryAliases ?? [])
    .map(normalizeText)
    .filter(Boolean);

  const candidates: ConflictCandidate[] = [];
  const seenKeys = new Set<string>();

  const pushCandidate = (c: Omit<ConflictCandidate, "id">) => {
    const key = `${c.matched_entity_id ?? ""}:${c.matched_matter_id ?? ""}:${c.match_type}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    candidates.push({
      id: `cand-${candidates.length + 1}-${Math.abs(hashSimple(key))}`,
      ...c,
    });
  };

  for (const entity of scopedEntities) {
    // Descobre pastas vinculadas à entidade para detectar sigilo e papel adverso
    const linkedMatters = scopedMatters.filter((m) =>
      m.parties.some((p) => p.entity_id === entity.id),
    );
    const hasRestrictedMatter =
      entity.is_confidential || linkedMatters.some((m) => m.is_restricted);
    const firstMatter = linkedMatters[0] ?? null;
    const isAdverseInAnyMatter = linkedMatters.some((m) =>
      m.parties.some(
        (p) =>
          p.entity_id === entity.id &&
          (p.party_role === "contraparte" || p.party_role === "advogado_adverso"),
      ),
    );

    const buildSignal = (reasonLabel: string) => {
      if (hasRestrictedMatter) {
        // SINAL MÍNIMO obrigatório sob sigilo — não expõe nome da pasta, objeto ou detalhes
        return `Sinal mínimo sob sigilo (${reasonLabel}) — acionar Sócio/Comitê de Conflitos para revisão restrita.`;
      }
      const matterInfo = firstMatter
        ? `Pasta ${firstMatter.code} (${firstMatter.title})`
        : "Cadastro de partes/clientes";
      return `${reasonLabel}: ${entity.full_name} — ${matterInfo}${isAdverseInAnyMatter ? " [Parte Adversa]" : ""}`;
    };

    // 1. Identificador exato (CPF/CNPJ/OAB)
    const entityDoc = normalizeDocumentId(entity.cpf_cnpj);
    if (normQueryDoc && entityDoc && normQueryDoc === entityDoc) {
      pushCandidate({
        matched_entity_id: hasRestrictedMatter ? null : entity.id,
        matched_matter_id: hasRestrictedMatter ? null : firstMatter?.id ?? null,
        match_type: "identificador_exato",
        similarity_score: 1,
        is_under_secrecy: hasRestrictedMatter,
        minimal_signal: buildSignal("Identificador CPF/CNPJ idêntico"),
        disposition: "pendente",
      });
      continue;
    }

    // 2. Grupo econômico
    if (
      normQueryGroup &&
      entity.economic_group &&
      computeNameSimilarity(normQueryGroup, entity.economic_group) >= 0.8
    ) {
      pushCandidate({
        matched_entity_id: hasRestrictedMatter ? null : entity.id,
        matched_matter_id: hasRestrictedMatter ? null : firstMatter?.id ?? null,
        match_type: "grupo_economico",
        similarity_score: computeNameSimilarity(
          normQueryGroup,
          entity.economic_group,
        ),
        is_under_secrecy: hasRestrictedMatter,
        minimal_signal: buildSignal("Vínculo de grupo econômico"),
        disposition: "pendente",
      });
    }

    // 3. Nome normalizado exato
    if (normQueryName && entity.normalized_name === normQueryName) {
      pushCandidate({
        matched_entity_id: hasRestrictedMatter ? null : entity.id,
        matched_matter_id: hasRestrictedMatter ? null : firstMatter?.id ?? null,
        match_type: isAdverseInAnyMatter ? "parte_adversa" : "nome_normalizado",
        similarity_score: 1,
        is_under_secrecy: hasRestrictedMatter,
        minimal_signal: buildSignal(
          isAdverseInAnyMatter
            ? "Correspondência exata com parte adversa"
            : "Nome normalizado idêntico",
        ),
        disposition: "pendente",
      });
      continue;
    }

    // 4. Aliases
    const entityAliases = entity.aliases.map(normalizeText);
    const aliasMatched =
      entityAliases.some(
        (al) =>
          (normQueryName && computeNameSimilarity(normQueryName, al) >= 0.82) ||
          normQueryAliases.some((qa) => computeNameSimilarity(qa, al) >= 0.82),
      ) ||
      normQueryAliases.some(
        (qa) => computeNameSimilarity(qa, entity.normalized_name) >= 0.82,
      );

    if (aliasMatched) {
      pushCandidate({
        matched_entity_id: hasRestrictedMatter ? null : entity.id,
        matched_matter_id: hasRestrictedMatter ? null : firstMatter?.id ?? null,
        match_type: "alias",
        similarity_score: 0.88,
        is_under_secrecy: hasRestrictedMatter,
        minimal_signal: buildSignal("Correspondência por alias / nome fantasia"),
        disposition: "pendente",
      });
      continue;
    }

    // 5. Similaridade textual (conflito ambíguo / homônimo)
    const sim = computeNameSimilarity(normQueryName, entity.normalized_name);
    if (sim >= 0.65) {
      pushCandidate({
        matched_entity_id: hasRestrictedMatter ? null : entity.id,
        matched_matter_id: hasRestrictedMatter ? null : firstMatter?.id ?? null,
        match_type: isAdverseInAnyMatter ? "parte_adversa" : "similaridade",
        similarity_score: sim,
        is_under_secrecy: hasRestrictedMatter,
        minimal_signal: buildSignal(
          `Similaridade nominal (${Math.round(sim * 100)}%)`,
        ),
        disposition: "pendente",
      });
    }
  }

  candidates.sort((a, b) => b.similarity_score - a.similarity_score);

  const recommendedStatus: ConflictCheck["status"] =
    candidates.length === 0 ? "sem_conflito" : "pendente_revisao";
  const blocksHiring =
    policyBlockHiring && recommendedStatus === "pendente_revisao";

  return {
    candidates,
    recommendedStatus,
    blocksHiring,
  };
}

export function canProceedWithHiring(
  conflictStatus:
    | "nao_verificado"
    | "pendente_revisao"
    | "liberado"
    | "liberado_com_excecao"
    | "bloqueado",
  policyBlockHiring: boolean = true,
): { allowed: boolean; reason?: string } {
  if (!policyBlockHiring) return { allowed: true };
  if (
    conflictStatus === "liberado" ||
    conflictStatus === "liberado_com_excecao"
  ) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason:
      conflictStatus === "bloqueado"
        ? "Contratação bloqueada por conflito de interesses confirmado."
        : "Contratação bloqueada: verificação de conflitos pendente de decisão e justificativa.",
  };
}

function hashSimple(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h;
}
