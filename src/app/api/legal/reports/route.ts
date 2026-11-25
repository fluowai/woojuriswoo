import { NextResponse } from "next/server";
import { evaluateMatterAccess } from "@/lib/legal/authz";
import {
  buildAssistiveAiSuggestion,
  computeLegalReports,
  type AiAssistSuggestion,
  type AiCitation,
} from "@/lib/legal/portal-reports-ai";
import {
  appendAuditEvent,
  DEMO_USERS,
  getIntegrationsStatus,
  getLegalStore,
} from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "reports", "read");
    const store = getLegalStore();
    const tz = store.governance[user.accountId]?.timezone ?? "America/Sao_Paulo";

    const authorizedMatters = store.matters.filter(
      (m) =>
        m.account_id === user.accountId &&
        evaluateMatterAccess(user, m, store.breakGlassGrants).allowed,
    );
    const intakes = store.intakes.filter((i) => i.account_id === user.accountId);
    const cases = store.cases.filter((c) => c.account_id === user.accountId);
    const deadlines = store.deadlines.filter((d) => d.account_id === user.accountId);
    const receivables = store.receivables.filter((r) => r.account_id === user.accountId);

    const kpiReport = computeLegalReports({
      intakes,
      matters: authorizedMatters,
      cases,
      deadlines,
      receivables,
      timezone: tz,
    });

    const units = store.units.filter((u) => u.account_id === user.accountId);
    const teams = store.teams.filter((t) => t.account_id === user.accountId);
    const members = Object.values(DEMO_USERS).filter(
      (u) => u.accountId === user.accountId,
    );
    const dsarRequests = store.dsarRequests.filter(
      (d) => d.account_id === user.accountId,
    );
    const auditEvents = store.auditEvents
      .filter((a) => a.account_id === user.accountId)
      .slice(0, 60);

    return NextResponse.json({
      kpiReport,
      units,
      teams,
      members,
      dsarRequests,
      auditEvents,
      integrations: getIntegrationsStatus(),
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// IA Assistiva com verificação de autorização na pasta + citações obrigatórias + registro de decisão
export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "ai_assist", "write");
    const body = (await request.json()) as {
      matterId?: string;
      taskKind: AiAssistSuggestion["taskKind"];
      inputText: string;
      citations: AiCitation[];
    };

    const store = getLegalStore();
    let canAccessAllSources = true;
    if (body.matterId) {
      const matter = store.matters.find((m) => m.id === body.matterId);
      if (!matter || !evaluateMatterAccess(user, matter, store.breakGlassGrants).allowed) {
        canAccessAllSources = false;
      }
    }

    const result = buildAssistiveAiSuggestion({
      taskKind: body.taskKind,
      untrustedInputText: body.inputText ?? "",
      citations: body.citations ?? [],
      canAccessAllSources,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }

    // Telemetria sem replicar conteúdo confidencial!
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: `ai_assist.${body.taskKind}`,
      resource_type: "ai_assist",
      resource_id: body.matterId ?? null,
      outcome: "allowed",
      metadata: {
        citationsCount: result.suggestion.citations.length,
        requiresHumanReview: true,
      },
    });

    return NextResponse.json({ suggestion: result.suggestion });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
