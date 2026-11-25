import { NextResponse } from "next/server";
import { evaluateMatterAccess, sanitizeMatterForUser } from "@/lib/legal/authz";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireLegalPermission(request, "matters", "read");
    const { id } = await context.params;
    const store = getLegalStore();
    const matter = store.matters.find((m) => m.id === id);

    if (!matter) {
      return NextResponse.json({ error: "Pasta jurídica não encontrada." }, { status: 404 });
    }

    const decision = evaluateMatterAccess(user, matter, store.breakGlassGrants);
    if (!decision.allowed) {
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "matter.read_denied",
        resource_type: "matter",
        resource_id: matter.id,
        outcome: "denied",
        reason: decision.reason,
      });
      return NextResponse.json(
        { error: decision.reason, code: "matter_access_denied" },
        { status: 403 },
      );
    }

    const sanitized = sanitizeMatterForUser(matter, decision);
    const linkedCases = store.cases.filter(
      (c) => c.account_id === user.accountId && c.matter_ids.includes(matter.id),
    );
    const deadlines = store.deadlines.filter(
      (d) => d.account_id === user.accountId && d.matter_id === matter.id,
    );
    const hearings = store.hearings.filter(
      (h) => h.account_id === user.accountId && h.matter_id === matter.id,
    );
    const documents = store.documents.filter(
      (d) => d.account_id === user.accountId && d.matter_id === matter.id,
    );
    const contracts = store.contracts.filter(
      (c) => c.account_id === user.accountId && c.matter_id === matter.id,
    );
    const receivables = store.receivables.filter(
      (r) => r.account_id === user.accountId && r.matter_id === matter.id,
    );
    const protocols = store.protocols.filter(
      (p) => p.account_id === user.accountId && p.matter_id === matter.id,
    );
    const audit = store.auditEvents.filter(
      (a) => a.account_id === user.accountId && a.resource_id === matter.id,
    );

    return NextResponse.json({
      matter: sanitized,
      accessDecision: decision,
      tabs: {
        cases: decision.minimalReferenceOnly ? [] : linkedCases,
        deadlines: decision.minimalReferenceOnly ? [] : deadlines,
        hearings: decision.minimalReferenceOnly ? [] : hearings,
        documents: decision.minimalReferenceOnly ? [] : documents,
        contracts,
        receivables,
        protocols: decision.minimalReferenceOnly ? [] : protocols,
        audit: decision.minimalReferenceOnly ? [] : audit,
      },
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireLegalPermission(request, "matters", "write");
    const { id } = await context.params;
    const store = getLegalStore();
    const matter = store.matters.find((m) => m.id === id);
    if (!matter) {
      return NextResponse.json({ error: "Pasta jurídica não encontrada." }, { status: 404 });
    }

    const decision = evaluateMatterAccess(user, matter, store.breakGlassGrants);
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.reason }, { status: 403 });
    }

    const body = (await request.json()) as {
      action:
        | "transfer_lead"
        | "grant_access"
        | "revoke_member"
        | "toggle_checklist"
        | "close_matter"
        | "update_fields";
      newLeadUserId?: string;
      newLeadName?: string;
      reassignOpenTasks?: boolean;
      targetUserId?: string;
      reason?: string;
      checklistId?: string;
      itemId?: string;
      next_step?: string;
      status?: typeof matter.status;
    };

    const now = new Date().toISOString();

    if (body.action === "transfer_lead" && body.newLeadUserId) {
      const prevLead = matter.lead_lawyer_user_id;
      matter.lead_lawyer_user_id = body.newLeadUserId;
      if (!matter.members.some((m) => m.user_id === body.newLeadUserId && m.is_active)) {
        matter.members.push({
          user_id: body.newLeadUserId,
          full_name: body.newLeadName ?? body.newLeadUserId,
          member_role: "responsavel",
          can_view_strategy: true,
          is_active: true,
        });
      }
      if (body.reassignOpenTasks) {
        for (const task of store.tasks) {
          if (
            task.matter_id === matter.id &&
            task.assigned_user_id === prevLead &&
            task.status !== "concluida"
          ) {
            task.assigned_user_id = body.newLeadUserId;
          }
        }
      }
      matter.updated_at = now;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "matter.transfer_lead",
        resource_type: "matter",
        resource_id: matter.id,
        outcome: "allowed",
        reason: body.reason ?? "Transferência de responsável",
        metadata: {
          previousLead: prevLead,
          newLead: body.newLeadUserId,
          reassignOpenTasks: Boolean(body.reassignOpenTasks),
        },
      });
      return NextResponse.json({ matter });
    }

    if (body.action === "grant_access" && body.targetUserId) {
      matter.access_grants.push({
        user_id: body.targetUserId,
        access_level: "read_write",
        granted_by_user_id: user.userId,
        reason: body.reason ?? "Concessão explícita em pasta restrita",
      });
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "matter.grant_access",
        resource_type: "matter",
        resource_id: matter.id,
        outcome: "allowed",
        reason: body.reason,
        metadata: { targetUserId: body.targetUserId },
      });
      return NextResponse.json({ matter });
    }

    if (body.action === "revoke_member" && body.targetUserId) {
      for (const m of matter.members) {
        if (m.user_id === body.targetUserId) {
          m.is_active = false;
          m.revoked_at = now;
        }
      }
      for (const g of matter.access_grants) {
        if (g.user_id === body.targetUserId && !g.revoked_at) {
          g.revoked_at = now;
        }
      }
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "matter.revoke_access",
        resource_type: "matter",
        resource_id: matter.id,
        outcome: "allowed",
        reason: body.reason ?? "Revogação de acesso na equipe da pasta",
        metadata: { targetUserId: body.targetUserId },
      });
      return NextResponse.json({ matter });
    }

    if (body.action === "toggle_checklist" && body.checklistId && body.itemId) {
      const chk = matter.checklists.find((c) => c.id === body.checklistId);
      const item = chk?.items.find((i) => i.id === body.itemId);
      if (item) {
        item.done = !item.done;
        item.completed_by = item.done ? user.userId : null;
        item.completed_at = item.done ? now : null;
      }
      matter.updated_at = now;
      return NextResponse.json({ matter });
    }

    if (body.action === "close_matter") {
      const pendingRequired = matter.checklists
        .flatMap((c) => c.items)
        .filter((i) => i.required && !i.done);
      if (pendingRequired.length > 0) {
        return NextResponse.json(
          {
            error: `Encerramento bloqueado: existem ${pendingRequired.length} item(ns) obrigatório(s) pendente(s) no checklist.`,
          },
          { status: 409 },
        );
      }
      matter.closure_checklist_completed = true;
      matter.accountability_completed = true;
      matter.client_delivery_approved = true;
      matter.status = "encerrado";
      matter.updated_at = now;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "matter.close",
        resource_type: "matter",
        resource_id: matter.id,
        outcome: "allowed",
      });
      return NextResponse.json({ matter });
    }

    if (body.action === "update_fields") {
      if (typeof body.next_step === "string") matter.next_step = body.next_step;
      if (body.status) matter.status = body.status;
      matter.updated_at = now;
      return NextResponse.json({ matter });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
