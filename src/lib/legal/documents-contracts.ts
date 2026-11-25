// ============================================================
// WooJuris — Documentos, Quarentena, Modelos Versionados,
// Contratos e Assinaturas (Adaptador Documenso + Manual)
// ============================================================

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  ContractStatus,
  DocumentTemplateField,
  LegalContract,
  LegalDocument,
  LegalDocumentTemplate,
} from "./types";

export const MAX_LEGAL_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export const ALLOWED_LEGAL_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
]);

export interface UploadValidationResult {
  valid: boolean;
  quarantineStatus: "quarentena" | "bloqueado";
  sha256: string;
  errors: string[];
}

export function validateAndHashUpload(params: {
  filename: string;
  mimeType: string;
  content: Buffer | string;
}): UploadValidationResult {
  const buf =
    typeof params.content === "string"
      ? Buffer.from(params.content, "utf8")
      : params.content;
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const errors: string[] = [];

  if (buf.byteLength === 0) {
    errors.push("Arquivo vazio não permitido.");
  }
  if (buf.byteLength > MAX_LEGAL_UPLOAD_BYTES) {
    errors.push(
      `Arquivo excede o limite de ${Math.round(MAX_LEGAL_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    );
  }
  if (!ALLOWED_LEGAL_MIME_TYPES.has(params.mimeType)) {
    errors.push(`Tipo MIME não permitido pela política de quarentena: ${params.mimeType}`);
  }
  if (/\.(exe|bat|cmd|sh|ps1|js|mjs|vbs)$/i.test(params.filename)) {
    errors.push("Extensão executável bloqueada pela política de segurança.");
  }

  return {
    valid: errors.length === 0,
    quarantineStatus: errors.length === 0 ? "quarentena" : "bloqueado",
    sha256,
    errors,
  };
}

/**
 * Só indexa ou disponibiliza para download/portal o que saiu da quarentena
 * e respeita a classificação de acesso.
 */
export function canExposeDocumentToPortal(doc: LegalDocument): {
  allowed: boolean;
  reason?: string;
} {
  if (doc.quarantine_status !== "aprovado") {
    return {
      allowed: false,
      reason: `Documento em estado "${doc.quarantine_status}" não pode ser baixado ou publicado no portal.`,
    };
  }
  if (!doc.portal_published || doc.confidentiality_level !== "publico_portal") {
    return {
      allowed: false,
      reason: "Documento não aprovado explicitamente para publicação no portal do cliente.",
    };
  }
  return { allowed: true };
}

/**
 * Renderização determinística de modelos versionados com validação de campos tipados.
 */
export function renderDocumentTemplate(
  template: LegalDocumentTemplate,
  values: Record<string, string | number | undefined>,
): { ok: true; rendered: string; sha256: string } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  for (const field of template.typed_fields) {
    const raw = values[field.key];
    const strVal = raw === undefined || raw === null ? "" : String(raw).trim();
    if (field.required && !strVal) {
      errors.push(`Campo obrigatório ausente: ${field.label} (${field.key})`);
      continue;
    }
    if (strVal) {
      const typeError = validateTypedField(field, strVal);
      if (typeError) errors.push(typeError);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const rendered = template.body_template.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (_m, key: string) => {
      const val = values[key];
      return val === undefined || val === null ? "" : String(val);
    },
  );
  const sha256 = createHash("sha256").update(rendered, "utf8").digest("hex");

  return { ok: true, rendered, sha256 };
}

function validateTypedField(
  field: DocumentTemplateField,
  value: string,
): string | null {
  switch (field.type) {
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{2}\/\d{2}\/\d{4}$/.test(value)
        ? null
        : `Campo "${field.label}" deve ser uma data válida (AAAA-MM-DD ou DD/MM/AAAA).`;
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? null
        : `Campo "${field.label}" deve ser um e-mail válido.`;
    case "cpf_cnpj": {
      const digits = value.replace(/\D/g, "");
      return digits.length === 11 || digits.length === 14
        ? null
        : `Campo "${field.label}" deve conter 11 (CPF) ou 14 (CNPJ) dígitos.`;
    }
    case "currency_cents":
      return /^\d+$/.test(value) || /^R\$\s?[\d.,]+$/.test(value)
        ? null
        : `Campo "${field.label}" deve ser um valor monetário válido.`;
    default:
      return null;
  }
}

/**
 * Transições válidas do ciclo de vida do contrato:
 * rascunho -> revisao -> aprovado -> enviado -> assinado | recusado | expirado
 * + cancelado a partir de estados não finais (ou distrato).
 */
const ALLOWED_CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  rascunho: ["revisao", "cancelado"],
  revisao: ["rascunho", "aprovado", "cancelado"],
  aprovado: ["enviado", "assinado", "cancelado"], // assinado direto permitido em formalização manual comprovada
  enviado: ["assinado", "recusado", "expirado", "cancelado"],
  assinado: [],
  recusado: ["rascunho"],
  expirado: ["enviado", "cancelado"],
  cancelado: [],
};

export function transitionContractStatus(
  contract: LegalContract,
  nextStatus: ContractStatus,
  evidence?: { manualEvidenceHash?: string; manualEvidenceNote?: string; now?: Date },
): { ok: true; contract: LegalContract } | { ok: false; error: string } {
  const allowed = ALLOWED_CONTRACT_TRANSITIONS[contract.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return {
      ok: false,
      error: `Transição de contrato inválida: "${contract.status}" → "${nextStatus}".`,
    };
  }

  if (nextStatus === "assinado" && contract.signature_method === "manual_comprovado") {
    if (!evidence?.manualEvidenceNote || evidence.manualEvidenceNote.trim().length < 5) {
      return {
        ok: false,
        error:
          "Formalização manual exige comprovação registrada (nota/referência do documento assinado).",
      };
    }
  }

  const now = evidence?.now ?? new Date();
  return {
    ok: true,
    contract: {
      ...contract,
      status: nextStatus,
      signed_at: nextStatus === "assinado" ? now.toISOString() : contract.signed_at,
      manual_evidence_hash:
        evidence?.manualEvidenceHash ?? contract.manual_evidence_hash,
      manual_evidence_note:
        evidence?.manualEvidenceNote ?? contract.manual_evidence_note,
    },
  };
}

/**
 * Verificação de assinatura HMAC-SHA256 para webhooks de provedor de assinatura (ex: Documenso)
 * + detecção de replay e eventos fora de ordem.
 */
export function verifySignatureWebhookHmac(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const cleanHeader = signatureHeader.replace(/^sha256=/i, "").trim();
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(cleanHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function processSignatureWebhookEvent(params: {
  contract: LegalContract;
  processedEventIds: Set<string>;
  eventId: string;
  eventType: "DOCUMENT_SENT" | "DOCUMENT_SIGNED" | "DOCUMENT_REJECTED" | "DOCUMENT_EXPIRED";
  occurredAt: string;
}): {
  outcome: "processed" | "duplicate_ignored" | "out_of_order_ignored" | "rejected_canceled";
  contract: LegalContract;
} {
  if (params.processedEventIds.has(params.eventId)) {
    return { outcome: "duplicate_ignored", contract: params.contract };
  }
  if (params.contract.status === "cancelado") {
    return { outcome: "rejected_canceled", contract: params.contract };
  }

  // Evento fora de ordem: já assinado não regressa para enviado
  if (
    params.contract.status === "assinado" &&
    params.eventType === "DOCUMENT_SENT"
  ) {
    params.processedEventIds.add(params.eventId);
    return { outcome: "out_of_order_ignored", contract: params.contract };
  }

  const mapStatus: Record<typeof params.eventType, ContractStatus> = {
    DOCUMENT_SENT: "enviado",
    DOCUMENT_SIGNED: "assinado",
    DOCUMENT_REJECTED: "recusado",
    DOCUMENT_EXPIRED: "expirado",
  };
  const target = mapStatus[params.eventType];
  const next: LegalContract = {
    ...params.contract,
    status: target,
    signed_at: target === "assinado" ? params.occurredAt : params.contract.signed_at,
  };
  params.processedEventIds.add(params.eventId);
  return { outcome: "processed", contract: next };
}
