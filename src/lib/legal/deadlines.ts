// ============================================================
// WooJuris — Motor de Cálculo, Revisão e Workflow de Prazos
//
// Regra de ouro:
// - Nenhum movimento ou comunicação vira prazo `confirmado` sozinho.
// - Todo cálculo nasce como `sugerido` ou `em_revisao` e exige
//   validação humana com evidência.
// - Rotinas separadas: CPC (dias úteis), Penal (dias corridos),
//   Trabalhista (CLT Art. 775 dias úteis), Administrativo e Manual.
// - Calendário incompleto ou não validado força `requires_manual_review`.
// - Prazo interno distinto do prazo legal; revisão gera histórico
//   e reprograma alertas sem duplicar envios.
// ============================================================

import type {
  CalendarException,
  CourtCalendar,
  DeadlineRevision,
  DeadlineStatus,
  LegalDeadline,
  ProceduralRegime,
} from "./types";

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function findException(
  isoDate: string,
  exceptions: CalendarException[],
): CalendarException | null {
  for (const ex of exceptions) {
    const start = ex.date.slice(0, 10);
    const end = (ex.end_date ?? ex.date).slice(0, 10);
    if (isoDate >= start && isoDate <= end) {
      return ex;
    }
  }
  return null;
}

export interface CalculateDeadlineInput {
  startDate: string; // YYYY-MM-DD (data de publicação/ciência ou termo inicial)
  countingDays: number;
  regime: ProceduralRegime;
  internalOffsetDays?: number; // quantos dias antes do prazo legal vence o prazo interno (padrão 2)
  calendar?: CourtCalendar | null;
  ruleCode?: string;
}

export interface CalculatedDeadlineOutput {
  legalDueDate: string;
  internalDueDate: string;
  requiresManualReview: boolean;
  initialStatus: DeadlineStatus;
  memory: LegalDeadline["calculation_memory"];
}

export function calculateDeadline(
  input: CalculateDeadlineInput,
): CalculatedDeadlineOutput {
  const steps: string[] = [];
  const skipped: Array<{ date: string; reason: string }> = [];
  const warnings: string[] = [];

  const exceptions = input.calendar?.exceptions ?? [];
  const calendarValidated = Boolean(input.calendar?.is_validated);
  const internalOffset = Math.max(0, input.internalOffsetDays ?? 2);

  if (!input.calendar) {
    warnings.push(
      "Calendário forense não informado: revisão manual obrigatória para feriados locais e suspensões.",
    );
  } else if (!calendarValidated) {
    warnings.push(
      `Calendário "${input.calendar.name}" ainda não validado pelo escritório: revisão manual obrigatória.`,
    );
  }

  if (input.regime === "manual") {
    const start = parseIsoDate(input.startDate);
    const due = addDays(start, Math.max(0, input.countingDays));
    const internal = addDays(due, -internalOffset);
    steps.push(
      `Contagem manual informada (${input.countingDays} dia(s) a partir de ${input.startDate}).`,
    );
    warnings.push("Regime manual requer conferência humana expressa.");
    return {
      legalDueDate: toIsoDate(due),
      internalDueDate: toIsoDate(internal < start ? start : internal),
      requiresManualReview: true,
      initialStatus: "em_revisao",
      memory: {
        steps,
        skipped_dates: skipped,
        calendar_validated: calendarValidated,
        warnings,
      },
    };
  }

  // CPC / CLT / Administrativo (dias úteis): exclui o dia do começo, inclui o do vencimento (Art. 224 CPC / Art. 775 CLT)
  // Penal (dias corridos): exclui o dia do começo (Art. 798 §1º CPP), conta dias corridos e prorroga se cair em dia não útil
  let cursor = parseIsoDate(input.startDate);
  steps.push(
    `Data de referência/termo inicial: ${input.startDate} (excluído o dia do começo, salvo regra penal material).`,
  );

  const countBusinessDays =
    input.regime === "cpc_dias_uteis" || input.regime === "trabalhista_clt";

  let counted = 0;
  const targetDays = Math.max(1, input.countingDays);

  if (countBusinessDays) {
    while (counted < targetDays) {
      cursor = addDays(cursor, 1);
      const iso = toIsoDate(cursor);
      if (isWeekend(cursor)) {
        skipped.push({ date: iso, reason: "Fim de semana" });
        continue;
      }
      const ex = findException(iso, exceptions);
      if (ex) {
        skipped.push({ date: iso, reason: `${ex.type}: ${ex.description}` });
        continue;
      }
      counted++;
    }
    steps.push(
      `Contados ${targetDays} dia(s) útil(eis) sob regime ${input.regime}. Vencimento legal em ${toIsoDate(cursor)}.`,
    );
  } else {
    // Penal (dias corridos) ou Administrativo (dias corridos com prorrogação para próximo dia útil)
    cursor = addDays(cursor, targetDays);
    steps.push(
      `Somados ${targetDays} dia(s) corrido(s) sob regime ${input.regime}: data bruta ${toIsoDate(cursor)}.`,
    );
    while (true) {
      const iso = toIsoDate(cursor);
      if (isWeekend(cursor)) {
        skipped.push({ date: iso, reason: "Prorrogação por fim de semana" });
        cursor = addDays(cursor, 1);
        continue;
      }
      const ex = findException(iso, exceptions);
      if (ex) {
        skipped.push({
          date: iso,
          reason: `Prorrogação por ${ex.type}: ${ex.description}`,
        });
        cursor = addDays(cursor, 1);
        continue;
      }
      break;
    }
    steps.push(`Vencimento legal ajustado para dia útil: ${toIsoDate(cursor)}.`);
  }

  const legalDueDate = toIsoDate(cursor);

  // Prazo interno: recua N dias úteis antes do prazo legal (nunca anterior à data inicial)
  let internalCursor = parseIsoDate(legalDueDate);
  let movedBack = 0;
  const startDt = parseIsoDate(input.startDate);
  while (movedBack < internalOffset && internalCursor > startDt) {
    internalCursor = addDays(internalCursor, -1);
    const iso = toIsoDate(internalCursor);
    if (!isWeekend(internalCursor) && !findException(iso, exceptions)) {
      movedBack++;
    }
  }
  const internalDueDate = toIsoDate(
    internalCursor < startDt ? startDt : internalCursor,
  );
  steps.push(
    `Prazo interno definido em ${internalDueDate} (${internalOffset} dia(s) útil(eis) de antecedência).`,
  );

  // Mesmo com calendário validado, NUNCA nasce confirmado!
  const requiresManualReview = !calendarValidated || warnings.length > 0;

  return {
    legalDueDate,
    internalDueDate,
    requiresManualReview,
    initialStatus: requiresManualReview ? "em_revisao" : "sugerido",
    memory: {
      steps,
      skipped_dates: skipped,
      calendar_validated: calendarValidated,
      warnings,
    },
  };
}

/**
 * Confirma prazo mediante validação humana + evidência obrigatória.
 * Suporta revisão por segunda pessoa quando configurada.
 */
export function confirmDeadline(
  deadline: LegalDeadline,
  validatorUserId: string,
  evidenceNote: string,
  now: Date = new Date(),
): { ok: true; deadline: LegalDeadline } | { ok: false; error: string } {
  if (!evidenceNote || evidenceNote.trim().length < 5) {
    return {
      ok: false,
      error:
        "Confirmação de prazo exige registro de evidência (ex.: conferência no DJE/eproc/recibo).",
    };
  }
  if (
    deadline.requires_second_reviewer &&
    deadline.validator_user_id &&
    deadline.validator_user_id === validatorUserId
  ) {
    return {
      ok: false,
      error:
        "Este prazo exige revisão por uma segunda pessoa distinta do primeiro validador.",
    };
  }

  const nextRevisionNumber = deadline.revision_number + 1;
  const isWaitingSecond =
    deadline.requires_second_reviewer && !deadline.validator_user_id;

  const nextStatus: DeadlineStatus = isWaitingSecond ? "em_revisao" : "confirmado";
  const revision: DeadlineRevision = {
    revision_number: nextRevisionNumber,
    previous_legal_due_date: deadline.legal_due_date,
    new_legal_due_date: deadline.legal_due_date,
    previous_internal_due_date: deadline.internal_due_date,
    new_internal_due_date: deadline.internal_due_date,
    previous_status: deadline.status,
    new_status: nextStatus,
    reason: isWaitingSecond
      ? `1ª validação concluída — aguardando 2º revisor. Evidência: ${evidenceNote}`
      : `Prazo confirmado após validação humana. Evidência: ${evidenceNote}`,
    changed_by_user_id: validatorUserId,
    alert_rescheduled: true,
    created_at: now.toISOString(),
  };

  // Reprograma alertas sem duplicar canal/data para a revisão ativa
  const alertKey = `rev-${nextRevisionNumber}-${deadline.internal_due_date}`;
  const updatedAlerts = deadline.alert_history.some((a) => a.id === alertKey)
    ? deadline.alert_history
    : [
        ...deadline.alert_history.map((a) =>
          a.status === "agendado" ? { ...a, status: "substituido" } : a,
        ),
        {
          id: alertKey,
          channel: "in_app+whatsapp",
          scheduled_for: `${deadline.internal_due_date}T12:00:00.000Z`,
          status: "agendado",
        },
      ];

  return {
    ok: true,
    deadline: {
      ...deadline,
      status: nextStatus,
      validator_user_id: deadline.validator_user_id ?? validatorUserId,
      second_reviewer_user_id: isWaitingSecond
        ? deadline.second_reviewer_user_id
        : deadline.requires_second_reviewer
          ? validatorUserId
          : deadline.second_reviewer_user_id,
      validated_at: now.toISOString(),
      evidence_note: evidenceNote,
      revision_number: nextRevisionNumber,
      revisions: [...deadline.revisions, revision],
      alert_history: updatedAlerts,
    },
  };
}

/**
 * Recalcula ou corrige prazo após revisão, gerando histórico e substituindo alertas anteriores.
 */
export function reviseDeadlineDates(
  deadline: LegalDeadline,
  params: {
    newLegalDueDate: string;
    newInternalDueDate: string;
    reason: string;
    changedByUserId: string;
    now?: Date;
  },
): LegalDeadline {
  const now = params.now ?? new Date();
  const nextRev = deadline.revision_number + 1;
  const revision: DeadlineRevision = {
    revision_number: nextRev,
    previous_legal_due_date: deadline.legal_due_date,
    new_legal_due_date: params.newLegalDueDate,
    previous_internal_due_date: deadline.internal_due_date,
    new_internal_due_date: params.newInternalDueDate,
    previous_status: deadline.status,
    new_status: "recalculado",
    reason: params.reason,
    changed_by_user_id: params.changedByUserId,
    alert_rescheduled: true,
    created_at: now.toISOString(),
  };

  const replacedAlerts = deadline.alert_history.map((a) =>
    a.status === "agendado" ? { ...a, status: "substituido" } : a,
  );
  replacedAlerts.push({
    id: `rev-${nextRev}-${params.newInternalDueDate}`,
    channel: "in_app+email",
    scheduled_for: `${params.newInternalDueDate}T12:00:00.000Z`,
    status: "agendado",
  });

  return {
    ...deadline,
    legal_due_date: params.newLegalDueDate,
    internal_due_date: params.newInternalDueDate,
    status: "recalculado",
    revision_number: nextRev,
    revisions: [...deadline.revisions, revision],
    alert_history: replacedAlerts,
  };
}
