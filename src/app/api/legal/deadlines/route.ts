import { NextResponse } from "next/server";
import {
  calculateDeadline,
  confirmDeadline,
  reviseDeadlineDates,
} from "@/lib/legal/deadlines";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type {
  LegalDeadline,
  LegalHearing,
  LegalTask,
  ProceduralRegime,
} from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "deadlines", "read");
    const store = getLegalStore();
    return NextResponse.json({
      deadlines: store.deadlines.filter((d) => d.account_id === user.accountId),
      calendars: store.calendars.filter((c) => c.account_id === user.accountId),
      tasks: store.tasks.filter((t) => t.account_id === user.accountId),
      hearings: store.hearings.filter((h) => h.account_id === user.accountId),
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "deadlines", "write");
    const body = (await request.json()) as {
      matter_id: string;
      case_id?: string;
      communication_id?: string;
      calendar_id?: string;
      title: string;
      nature?: LegalDeadline["nature"];
      procedural_regime?: ProceduralRegime;
      counting_days: number;
      start_date: string;
      reference_event: string;
      internal_offset_days?: number;
      requires_second_reviewer?: boolean;
      responsible_user_id?: string;
    };

    if (!body.matter_id || !body.title?.trim() || !body.start_date) {
      return NextResponse.json(
        { error: "Pasta, título e data inicial de referência são obrigatórios." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const calendar = body.calendar_id
      ? store.calendars.find(
          (c) => c.id === body.calendar_id && c.account_id === user.accountId,
        )
      : null;

    const regime: ProceduralRegime = body.procedural_regime ?? "cpc_dias_uteis";
    const calc = calculateDeadline({
      startDate: body.start_date,
      countingDays: Number(body.counting_days) || 15,
      regime,
      internalOffsetDays: body.internal_offset_days ?? 2,
      calendar,
    });

    const deadline: LegalDeadline = {
      id: `dl-${Date.now()}`,
      account_id: user.accountId,
      matter_id: body.matter_id,
      case_id: body.case_id ?? null,
      communication_id: body.communication_id ?? null,
      calendar_id: calendar?.id ?? null,
      title: body.title.trim(),
      nature: body.nature ?? "processual",
      procedural_regime: regime,
      rule_code: `${regime.toUpperCase()}_${body.counting_days}D`,
      rule_version: "2026.1",
      counting_days: Number(body.counting_days) || 15,
      reference_event: body.reference_event || "Lançamento manual",
      start_date: body.start_date,
      legal_due_date: calc.legalDueDate,
      internal_due_date: calc.internalDueDate,
      timezone: calendar?.timezone ?? "America/Sao_Paulo",
      calculation_memory: calc.memory,
      requires_manual_review: calc.requiresManualReview,
      requires_second_reviewer: Boolean(body.requires_second_reviewer),
      // NUNCA nasce confirmado automaticamente
      status: calc.initialStatus,
      responsible_user_id: body.responsible_user_id ?? user.userId,
      revision_number: 1,
      revisions: [],
      alert_history: [],
    };

    store.deadlines.unshift(deadline);
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "deadline.create_suggested",
      resource_type: "deadline",
      resource_id: deadline.id,
      outcome: "allowed",
      metadata: {
        status: deadline.status,
        legal_due_date: deadline.legal_due_date,
        internal_due_date: deadline.internal_due_date,
      },
    });

    return NextResponse.json({ deadline }, { status: 201 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireLegalPermission(request, "deadlines", "validate");
    const body = (await request.json()) as {
      id: string;
      action: "confirm" | "revise" | "complete" | "cancel";
      evidence_note?: string;
      new_legal_due_date?: string;
      new_internal_due_date?: string;
      reason?: string;
    };

    const store = getLegalStore();
    const idx = store.deadlines.findIndex(
      (d) => d.id === body.id && d.account_id === user.accountId,
    );
    if (idx < 0) {
      return NextResponse.json({ error: "Prazo não encontrado." }, { status: 404 });
    }

    const current = store.deadlines[idx];

    if (body.action === "confirm") {
      const res = confirmDeadline(current, user.userId, body.evidence_note ?? "");
      if (!res.ok) {
        return NextResponse.json({ error: res.error }, { status: 400 });
      }
      store.deadlines[idx] = res.deadline;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "deadline.confirm",
        resource_type: "deadline",
        resource_id: current.id,
        outcome: "allowed",
        reason: body.evidence_note,
      });
      return NextResponse.json({ deadline: res.deadline });
    }

    if (body.action === "revise") {
      if (!body.new_legal_due_date || !body.new_internal_due_date || !body.reason?.trim()) {
        return NextResponse.json(
          { error: "Nova data legal, nova data interna e motivo são obrigatórios para recalcular." },
          { status: 400 },
        );
      }
      const revised = reviseDeadlineDates(current, {
        newLegalDueDate: body.new_legal_due_date,
        newInternalDueDate: body.new_internal_due_date,
        reason: body.reason.trim(),
        changedByUserId: user.userId,
      });
      store.deadlines[idx] = revised;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "deadline.revise",
        resource_type: "deadline",
        resource_id: current.id,
        outcome: "allowed",
        reason: body.reason.trim(),
      });
      return NextResponse.json({ deadline: revised });
    }

    if (body.action === "complete") {
      current.status = "cumprido";
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "deadline.complete",
        resource_type: "deadline",
        resource_id: current.id,
        outcome: "allowed",
      });
      return NextResponse.json({ deadline: current });
    }

    if (body.action === "cancel") {
      current.status = "cancelado";
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "deadline.cancel",
        resource_type: "deadline",
        resource_id: current.id,
        outcome: "allowed",
        reason: body.reason ?? "Cancelado",
      });
      return NextResponse.json({ deadline: current });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Criação rápida de tarefa jurídica ou audiência/evento na agenda
export async function PUT(request: Request) {
  try {
    const user = await requireLegalPermission(request, "agenda", "write");
    const body = (await request.json()) as
      | { kind: "task"; payload: Partial<LegalTask> }
      | { kind: "hearing"; payload: Partial<LegalHearing> }
      | { kind: "task_status"; taskId: string; status: LegalTask["status"] };

    const store = getLegalStore();

    if (body.kind === "task") {
      const p = body.payload;
      if (!p.title?.trim()) {
        return NextResponse.json({ error: "Título da tarefa é obrigatório." }, { status: 400 });
      }
      const task: LegalTask = {
        id: `tsk-${Date.now()}`,
        account_id: user.accountId,
        matter_id: p.matter_id ?? null,
        deadline_id: p.deadline_id ?? null,
        assigned_user_id: p.assigned_user_id ?? user.userId,
        created_by_user_id: user.userId,
        title: p.title.trim(),
        priority: p.priority ?? "media",
        status: "a_fazer",
        due_date: p.due_date ?? null,
        estimated_minutes: p.estimated_minutes ?? 60,
        logged_minutes: 0,
      };
      store.tasks.unshift(task);
      return NextResponse.json({ task }, { status: 201 });
    }

    if (body.kind === "task_status") {
      const task = store.tasks.find(
        (t) => t.id === body.taskId && t.account_id === user.accountId,
      );
      if (!task) {
        return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
      }
      task.status = body.status;
      return NextResponse.json({ task });
    }

    if (body.kind === "hearing") {
      const p = body.payload;
      if (!p.title?.trim() || !p.matter_id || !p.starts_at) {
        return NextResponse.json(
          { error: "Pasta, título e data/hora de início são obrigatórios." },
          { status: 400 },
        );
      }
      const hearing: LegalHearing = {
        id: `hr-${Date.now()}`,
        account_id: user.accountId,
        matter_id: p.matter_id,
        case_id: p.case_id ?? null,
        event_type: p.event_type ?? "audiencia",
        title: p.title.trim(),
        public_minimal_summary:
          p.public_minimal_summary?.trim() ||
          `Compromisso Jurídico — Pasta ${p.matter_id}`,
        starts_at: p.starts_at,
        ends_at:
          p.ends_at ??
          new Date(new Date(p.starts_at).getTime() + 3600 * 1000).toISOString(),
        timezone: p.timezone ?? "America/Sao_Paulo",
        modality: p.modality ?? "remota",
        location_or_link: p.location_or_link ?? null,
        participants: p.participants ?? [user.fullName],
        preparation_notes: p.preparation_notes ?? null,
        status: "agendada",
        responsible_user_id: p.responsible_user_id ?? user.userId,
      };
      store.hearings.unshift(hearing);
      return NextResponse.json({ hearing }, { status: 201 });
    }

    return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
