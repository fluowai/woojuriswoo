import { NextResponse } from "next/server";
import { normalizeDocumentId, runConflictSearch } from "@/lib/legal/conflicts";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { ConflictCheck } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "conflicts", "read");
    const store = getLegalStore();
    const checks = store.conflictChecks.filter(
      (c) => c.account_id === user.accountId,
    );
    return NextResponse.json({ conflictChecks: checks });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "conflicts", "write");
    const body = (await request.json()) as {
      queryName: string;
      queryDocument?: string;
      queryAliases?: string[];
      queryEconomicGroup?: string;
      intakeId?: string;
      matterId?: string;
      triggerReason?: ConflictCheck["trigger_reason"];
    };

    if (!body.queryName?.trim() && !body.queryDocument?.trim()) {
      return NextResponse.json(
        { error: "Informe ao menos o nome ou CPF/CNPJ para pesquisar conflitos." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const policyBlock =
      store.governance[user.accountId]?.conflict_block_hiring ?? true;

    const evaluation = runConflictSearch(
      {
        accountId: user.accountId,
        queryName: body.queryName ?? "",
        queryDocument: body.queryDocument,
        queryAliases: body.queryAliases ?? [],
        queryEconomicGroup: body.queryEconomicGroup,
        intakeId: body.intakeId,
        matterId: body.matterId,
        triggerReason: body.triggerReason ?? "triagem",
        requestedByUserId: user.userId,
      },
      store.people,
      store.matters,
      policyBlock,
    );

    const check: ConflictCheck = {
      id: `chk-${Date.now()}`,
      account_id: user.accountId,
      intake_id: body.intakeId ?? null,
      matter_id: body.matterId ?? null,
      trigger_reason: body.triggerReason ?? "triagem",
      query_name: body.queryName?.trim() || "(Busca por documento)",
      query_document_normalized: normalizeDocumentId(body.queryDocument) || null,
      query_aliases: body.queryAliases ?? [],
      query_economic_group: body.queryEconomicGroup ?? null,
      status: evaluation.recommendedStatus,
      requested_by_user_id: user.userId,
      candidates: evaluation.candidates,
      created_at: new Date().toISOString(),
    };

    store.conflictChecks.unshift(check);

    // Atualiza status de conflito na oportunidade vinculada
    if (body.intakeId) {
      const intake = store.intakes.find(
        (i) => i.id === body.intakeId && i.account_id === user.accountId,
      );
      if (intake) {
        intake.conflict_status =
          check.status === "sem_conflito" ? "liberado" : "pendente_revisao";
        if (intake.stage === "triagem") intake.stage = "conflito";
      }
    }

    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "conflict.search",
      resource_type: "conflict_check",
      resource_id: check.id,
      outcome: "allowed",
      metadata: {
        candidatesCount: check.candidates.length,
        hasSecrecySignal: check.candidates.some((c) => c.is_under_secrecy),
        recommendedStatus: check.status,
      },
    });

    return NextResponse.json(
      {
        conflictCheck: check,
        blocksHiring: evaluation.blocksHiring,
      },
      { status: 201 },
    );
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    // Decisão/aprovação de conflito exige permissão 'approve' (Sócio/Coordenador)
    const user = await requireLegalPermission(request, "conflicts", "approve");
    const body = (await request.json()) as {
      id: string;
      decision: "falso_positivo" | "conflito_confirmado" | "excecao_autorizada" | "sem_conflito";
      justification: string;
      evidenceSummary?: string;
    };

    if (!body.justification || body.justification.trim().length < 8) {
      return NextResponse.json(
        { error: "Justificativa formal (mínimo 8 caracteres) é obrigatória na decisão de conflito." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const check = store.conflictChecks.find(
      (c) => c.id === body.id && c.account_id === user.accountId,
    );
    if (!check) {
      return NextResponse.json(
        { error: "Verificação de conflito não encontrada." },
        { status: 404 },
      );
    }

    check.status = body.decision;
    check.decision_justification = body.justification.trim();
    check.evidence_summary = body.evidenceSummary ?? null;
    check.decided_by_user_id = user.userId;
    check.decided_at = new Date().toISOString();

    for (const cand of check.candidates) {
      cand.disposition =
        body.decision === "falso_positivo"
          ? "falso_positivo"
          : body.decision === "conflito_confirmado"
            ? "conflito_real"
            : body.decision === "excecao_autorizada"
              ? "excecao"
              : "falso_positivo";
    }

    if (check.intake_id) {
      const intake = store.intakes.find(
        (i) => i.id === check.intake_id && i.account_id === user.accountId,
      );
      if (intake) {
        intake.conflict_status =
          body.decision === "conflito_confirmado"
            ? "bloqueado"
            : body.decision === "excecao_autorizada"
              ? "liberado_com_excecao"
              : "liberado";
      }
    }

    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: `conflict.decide.${body.decision}`,
      resource_type: "conflict_check",
      resource_id: check.id,
      outcome: "allowed",
      reason: check.decision_justification,
    });

    return NextResponse.json({ conflictCheck: check });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
