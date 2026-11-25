// ============================================================
// WooJuris — Normalização, validação CNJ (Res. CNJ 65/2008) e
// catálogo oficial de aliases da API Pública DataJud.
//
// Regra de segurança:
// NUNCA montar URL do DataJud a partir de entrada livre do usuário.
// Resolver apenas contra o catálogo oficial whitelisted abaixo.
// ============================================================

export interface TribunalCatalogEntry {
  code: string; // ex: "TJSC", "TRF4", "TRT12"
  name: string;
  segmentDigit: string; // J (1..9)
  tribunalDigits: string; // TR (01..99)
  datajudAlias: string; // ex: "api_publica_tjsc"
  pilotSupported: boolean;
}

export const DATAJUD_TRIBUNAL_CATALOG: readonly TribunalCatalogEntry[] = [
  // Piloto obrigatório (TJSC, TRF4, TRT12)
  {
    code: "TJSC",
    name: "Tribunal de Justiça de Santa Catarina",
    segmentDigit: "8",
    tribunalDigits: "24",
    datajudAlias: "api_publica_tjsc",
    pilotSupported: true,
  },
  {
    code: "TRF4",
    name: "Tribunal Regional Federal da 4ª Região",
    segmentDigit: "4",
    tribunalDigits: "04",
    datajudAlias: "api_publica_trf4",
    pilotSupported: true,
  },
  {
    code: "TRT12",
    name: "Tribunal Regional do Trabalho da 12ª Região (SC)",
    segmentDigit: "5",
    tribunalDigits: "12",
    datajudAlias: "api_publica_trt12",
    pilotSupported: true,
  },
  // Demais tribunais principais do catálogo oficial CNJ
  {
    code: "TJSP",
    name: "Tribunal de Justiça de São Paulo",
    segmentDigit: "8",
    tribunalDigits: "26",
    datajudAlias: "api_publica_tjsp",
    pilotSupported: false,
  },
  {
    code: "TJRJ",
    name: "Tribunal de Justiça do Rio de Janeiro",
    segmentDigit: "8",
    tribunalDigits: "19",
    datajudAlias: "api_publica_tjrj",
    pilotSupported: false,
  },
  {
    code: "TJMG",
    name: "Tribunal de Justiça de Minas Gerais",
    segmentDigit: "8",
    tribunalDigits: "13",
    datajudAlias: "api_publica_tjmg",
    pilotSupported: false,
  },
  {
    code: "TJRS",
    name: "Tribunal de Justiça do Rio Grande do Sul",
    segmentDigit: "8",
    tribunalDigits: "21",
    datajudAlias: "api_publica_tjrs",
    pilotSupported: false,
  },
  {
    code: "TJPR",
    name: "Tribunal de Justiça do Paraná",
    segmentDigit: "8",
    tribunalDigits: "16",
    datajudAlias: "api_publica_tjpr",
    pilotSupported: false,
  },
  {
    code: "TJDFT",
    name: "Tribunal de Justiça do Distrito Federal e Territórios",
    segmentDigit: "8",
    tribunalDigits: "07",
    datajudAlias: "api_publica_tjdft",
    pilotSupported: false,
  },
  {
    code: "TRF1",
    name: "Tribunal Regional Federal da 1ª Região",
    segmentDigit: "4",
    tribunalDigits: "01",
    datajudAlias: "api_publica_trf1",
    pilotSupported: false,
  },
  {
    code: "TRF3",
    name: "Tribunal Regional Federal da 3ª Região",
    segmentDigit: "4",
    tribunalDigits: "03",
    datajudAlias: "api_publica_trf3",
    pilotSupported: false,
  },
  {
    code: "TRT2",
    name: "Tribunal Regional do Trabalho da 2ª Região (SP)",
    segmentDigit: "5",
    tribunalDigits: "02",
    datajudAlias: "api_publica_trt2",
    pilotSupported: false,
  },
  {
    code: "STJ",
    name: "Superior Tribunal de Justiça",
    segmentDigit: "3",
    tribunalDigits: "00",
    datajudAlias: "api_publica_stj",
    pilotSupported: false,
  },
  {
    code: "TST",
    name: "Tribunal Superior do Trabalho",
    segmentDigit: "5",
    tribunalDigits: "00",
    datajudAlias: "api_publica_tst",
    pilotSupported: false,
  },
] as const;

export interface ParsedCnj {
  valid: boolean;
  original: string;
  digits: string; // 20 dígitos se válido estruturalmente
  formatted: string | null; // NNNNNNN-DD.AAAA.J.TR.OOOO
  sequential?: string;
  checkDigits?: string;
  expectedCheckDigits?: string;
  year?: string;
  segment?: string;
  tribunal?: string;
  origin?: string;
  suggestedTribunal?: TribunalCatalogEntry | null;
  error?: string;
}

/**
 * Calcula os 2 dígitos verificadores CNJ conforme Resolução CNJ nº 65/2008:
 * DD = 98 - ((NNNNNNNAAAAJTROOOO00) mod 97)
 */
export function computeCnjCheckDigits(
  sequential7: string,
  year4: string,
  segment1: string,
  tribunal2: string,
  origin4: string,
): string {
  const numeric = BigInt(`${sequential7}${year4}${segment1}${tribunal2}${origin4}00`);
  const remainder = Number(numeric % BigInt(97));
  const dv = 98 - remainder;
  return String(dv).padStart(2, "0");
}

/**
 * Gera um número CNJ sintético válido (com DV correto) para testes e fixtures.
 */
export function buildValidCnj(
  sequential7: string,
  year4: string,
  segment1: string,
  tribunal2: string,
  origin4: string,
): string {
  const seq = sequential7.padStart(7, "0").slice(-7);
  const yr = year4.padStart(4, "0").slice(-4);
  const seg = segment1.slice(0, 1);
  const tr = tribunal2.padStart(2, "0").slice(-2);
  const orig = origin4.padStart(4, "0").slice(-4);
  const dv = computeCnjCheckDigits(seq, yr, seg, tr, orig);
  return `${seq}-${dv}.${yr}.${seg}.${tr}.${orig}`;
}

export function formatCnjDigits(digits20: string): string {
  const d = digits20.replace(/\D/g, "");
  if (d.length !== 20) return digits20;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

export function suggestTribunalFromCnj(
  segment1: string,
  tribunal2: string,
): TribunalCatalogEntry | null {
  return (
    DATAJUD_TRIBUNAL_CATALOG.find(
      (entry) =>
        entry.segmentDigit === segment1 && entry.tribunalDigits === tribunal2,
    ) ?? null
  );
}

export function lookupTribunalByCode(code: string): TribunalCatalogEntry | null {
  const upper = code.trim().toUpperCase();
  return (
    DATAJUD_TRIBUNAL_CATALOG.find((entry) => entry.code === upper) ?? null
  );
}

export function lookupTribunalByAlias(alias: string): TribunalCatalogEntry | null {
  const norm = alias.trim().toLowerCase();
  return (
    DATAJUD_TRIBUNAL_CATALOG.find((entry) => entry.datajudAlias === norm) ?? null
  );
}

/**
 * Normaliza e valida um número CNJ (20 dígitos + DV mod 97).
 * Preserva o formato original e retorna a pista do tribunal (que sempre deve
 * ser confirmada com a fonte).
 */
export function parseAndValidateCnj(raw: string): ParsedCnj {
  const original = raw.trim();
  const digits = original.replace(/\D/g, "");

  if (digits.length !== 20) {
    return {
      valid: false,
      original,
      digits,
      formatted: null,
      error: `Numeração CNJ deve conter exatamente 20 dígitos (recebidos ${digits.length}). Para processos legados ou administrativos, utilize o campo de identificador legado.`,
    };
  }

  const sequential = digits.slice(0, 7);
  const checkDigits = digits.slice(7, 9);
  const year = digits.slice(9, 13);
  const segment = digits.slice(13, 14);
  const tribunal = digits.slice(14, 16);
  const origin = digits.slice(16, 20);

  const expectedCheckDigits = computeCnjCheckDigits(
    sequential,
    year,
    segment,
    tribunal,
    origin,
  );
  const suggestedTribunal = suggestTribunalFromCnj(segment, tribunal);
  const formatted = formatCnjDigits(digits);

  if (checkDigits !== expectedCheckDigits) {
    return {
      valid: false,
      original,
      digits,
      formatted,
      sequential,
      checkDigits,
      expectedCheckDigits,
      year,
      segment,
      tribunal,
      origin,
      suggestedTribunal,
      error: `Dígito verificador CNJ inválido (informado ${checkDigits}, esperado ${expectedCheckDigits}).`,
    };
  }

  return {
    valid: true,
    original,
    digits,
    formatted,
    sequential,
    checkDigits,
    expectedCheckDigits,
    year,
    segment,
    tribunal,
    origin,
    suggestedTribunal,
  };
}
