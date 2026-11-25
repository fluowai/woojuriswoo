import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { DATAJUD_TRIBUNAL_CATALOG, parseAndValidateCnj } from "@/lib/legal/cnj";
import { queryDataJudProcess, reconcileMovements } from "@/lib/legal/datajud";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { CourtCase, ProtocolReceipt } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "cases", "read");
    const store = getLegalStore();
    const cases = store.cases.filter((c) => c.account_id === user.accountId);
    const protocols = store.protocols.filter((p) => p.account_id === user.accountId);

    return NextResponse.json({
      cases,
      protocols,
      tribunalCatalog: DATAJUD_TRIBUNAL_CATALOG,
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Cadastro manual de processo (com CNJ validado ou identificador legado/administrativo)
export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "cases", "write");
    const body = (await request.json()) as {
      cnj_number?: string;
      legacy_number?: string;
      tribunal_code: string;
      degree?: string;
      court_organ: string;
      judicial_system?: CourtCase["judicial_system"];
      case_class?: string;
      subjects?: string[];
      matter_ids?: string[];
      is_sealed?: boolean;
    };

    let formattedCnj: string | null = null;
    let normalizedCnj: string | null = null;
    let tribunalAlias: string | null = null;

    if (body.cnj_number?.trim()) {
      const parsed = parseAndValidateCnj(body.cnj_number);
      if (!parsed.valid) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      formattedCnj = parsed.formatted;
      normalizedCnj = parsed.digits;
      tribunalAlias = parsed.suggestedTribunal?.datajudAlias ?? null;
    } else if (!body.legacy_number?.trim()) {
      return NextResponse.json(
        { error: "Informe um número CNJ válido ou um identificador legado/administrativo." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const newCase: CourtCase = {
      id: `case-${Date.now()}`,
      account_id: user.accountId,
      matter_ids: body.matter_ids ?? [],
      cnj_number: formattedCnj,
      cnj_normalized: normalizedCnj,
      legacy_number: body.legacy_number?.trim() || null,
      tribunal_code: body.tribunal_code || "MANUAL",
      tribunal_alias: tribunalAlias,
      degree: body.degree || "G1",
      court_organ: body.court_organ || "Órgão não informado",
      judicial_system: body.judicial_system ?? "manual",
      case_class: body.case_class ?? null,
      subjects: body.subjects ?? [],
      case_status: "ativo",
      is_sealed: Boolean(body.is_sealed),
      source_records: [
        {
          id: `src-man-${Date.now()}`,
          source_name: "manual",
          source_record_id: normalizedCnj || body.legacy_number || `manual-${Date.now()}`,
          degree: body.degree || "G1",
          court_organ: body.court_organ || "Cadastro manual",
          sync_status: "ok",
          last_attempt_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
        },
      ],
      movements: [],
      created_at: new Date().toISOString(),
    };

    store.cases.unshift(newCase);
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "case.create_manual",
      resource_type: "court_case",
      resource_id: newCase.id,
      outcome: "allowed",
      metadata: { tribunal_code: newCase.tribunal_code, is_sealed: newCase.is_sealed },
    });

    return NextResponse.json({ courtCase: newCase }, { status: 201 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Consulta oficial / homologação DataJud CNJ + sincronização com deduplicação
export async function PUT(request: Request) {
  try {
    const user = await requireLegalPermission(request, "cases", "write");
    const body = (await request.json()) as {
      cnj: string;
      tribunalCode?: string;
      attachToCaseId?: string;
      matterId?: string;
    };

    const result = await queryDataJudProcess({
      cnj: body.cnj,
      tribunalCodeOverride: body.tribunalCode,
    });

    const store = getLegalStore();
    let syncedCase: CourtCase | null = null;
    let reconciliationStats: { inserted: number; duplicatesSkipped: number; outOfOrderCount: number } | null = null;

    if (result.hits.length > 0 && (body.attachToCaseId || body.matterId)) {
      const primaryHit = result.hits[0];
      syncedCase =
        store.cases.find(
          (c) =>
            c.account_id === user.accountId &&
            (c.id === body.attachToCaseId || c.cnj_normalized === primaryHit.cnjDigits),
        ) ?? null;

      if (!syncedCase) {
        syncedCase = {
          id: `case-dj-${Date.now()}`,
          account_id: user.accountId,
          matter_ids: body.matterId ? [body.matterId] : [],
          cnj_number: primaryHit.cnjFormatted,
          cnj_normalized: primaryHit.cnjDigits,
          tribunal_code: primaryHit.tribunalCode,
          tribunal_alias: primaryHit.tribunalAlias,
          degree: primaryHit.degree,
          court_organ: primaryHit.courtOrgan,
          judicial_system: "datajud",
          case_class: primaryHit.caseClass,
          subjects: primaryHit.subjects,
          filing_date: primaryHit.filingDate,
          case_status: "ativo",
          is_sealed: false,
          source_records: [],
          movements: [],
          created_at: new Date().toISOString(),
        };
        store.cases.unshift(syncedCase);
      }

      // Atualiza registros por grau/instância sem sobrescrever variantes distintas
      for (const hit of result.hits) {
        const idx = syncedCase.source_records.findIndex(
          (r) => r.source_record_id === hit.sourceRecordId,
        );
        const rec = {
          id: `src-${hit.sourceRecordId}`,
          source_name: "datajud" as const,
          source_record_id: hit.sourceRecordId,
          tribunal_alias: hit.tribunalAlias,
          degree: hit.degree,
          court_organ: hit.courtOrgan,
          sync_status: result.status,
          last_attempt_at: result.attemptedAt,
          last_success_at: result.succeededAt,
          source_updated_at: hit.sourceUpdatedAt,
        };
        if (idx >= 0) syncedCase.source_records[idx] = rec;
        else syncedCase.source_records.push(rec);
      }

      const incomingMovs = result.hits.flatMap((h) =>
        h.movements.map((m) => ({
          sourceName: "datajud",
          externalCode: m.codigo !== undefined ? String(m.codigo) : null,
          occurredAt: m.dataHora,
          title: m.nome,
          complements: (m.complementosTabelados ?? []).map((c) => ({
            name: c.nome ?? "complemento",
            value: c.descricao ?? String(c.valor ?? ""),
          })),
        })),
      );

      const recResult = reconcileMovements(
        syncedCase.id,
        syncedCase.movements,
        incomingMovs,
      );
      syncedCase.movements = recResult.merged;
      reconciliationStats = {
        inserted: recResult.inserted.length,
        duplicatesSkipped: recResult.duplicatesSkipped,
        outOfOrderCount: recResult.outOfOrderCount,
      };
    }

    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "datajud.query",
      resource_type: "court_case",
      resource_id: syncedCase?.id ?? null,
      outcome: "allowed",
      metadata: {
        tribunal: result.tribunalCode,
        status: result.status,
        mode: result.mode,
        hitsCount: result.hits.length,
      },
    });

    return NextResponse.json({
      result,
      syncedCase,
      reconciliationStats,
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Registro de protocolo manual com comprovante e hash
export async function PATCH(request: Request) {
  try {
    const user = await requireLegalPermission(request, "cases", "write");
    const body = (await request.json()) as {
      matter_id: string;
      case_id?: string;
      protocol_number: string;
      protocol_type?: ProtocolReceipt["protocol_type"];
      system_name?: string;
      receipt_filename: string;
      notes?: string;
    };

    if (!body.matter_id || !body.protocol_number?.trim() || !body.receipt_filename?.trim()) {
      return NextResponse.json(
        { error: "Pasta, número de protocolo e nome do comprovante/recibo são obrigatórios." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const receiptHash = createHash("sha256")
      .update(`${body.matter_id}:${body.protocol_number}:${body.receipt_filename}`)
      .digest("hex");

    const protocol: ProtocolReceipt = {
      id: `prot-${Date.now()}`,
      account_id: user.accountId,
      matter_id: body.matter_id,
      case_id: body.case_id ?? null,
      protocol_number: body.protocol_number.trim(),
      protocol_type: body.protocol_type ?? "peticao",
      system_name: body.system_name ?? "Manual (eproc/PJe/e-SAJ)",
      filed_at: new Date().toISOString(),
      filed_by_user_id: user.userId,
      receipt_filename: body.receipt_filename.trim(),
      receipt_hash: receiptHash,
      notes: body.notes ?? null,
    };

    store.protocols.unshift(protocol);
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "protocol.register_manual",
      resource_type: "protocol",
      resource_id: protocol.id,
      outcome: "allowed",
      metadata: { matter_id: protocol.matter_id, protocol_number: protocol.protocol_number },
    });

    return NextResponse.json({ protocol }, { status: 201 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
