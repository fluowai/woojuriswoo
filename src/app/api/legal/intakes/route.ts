import { NextResponse } from "next/server";
import { canProceedWithHiring } from "@/lib/legal/conflicts";
import {
  appendAuditEvent,
  DEFAULT_CHECKLISTS_BY_AREA,
  getLegalStore,
} from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { LegalIntake, Matter, MatterType, PracticeArea } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "intake_inbox", "read");
    const store = getLegalStore();
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get("stage");
    const area = searchParams.get("area");
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();

    let items = store.intakes.filter((i) => i.account_id === user.accountId);
    if (stage && stage !== "all") items = items.filter((i) => i.stage === stage);
    if (area && area !== "all") items = items.filter((i) => i.practice_area === area);
    if (q) {
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.summary ?? "").toLowerCase().includes(q) ||
          (i.opposing_party_name ?? "").toLowerCase().includes(q),
      );
    }

    return NextResponse.json({
      intakes: items,
      total: items.length,
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "intake_inbox", "write");
    const body = (await request.json()) as Partial<LegalIntake>;
    if (!body.title?.trim()) {
      return NextResponse.json(
        { error: "Título da oportunidade/atendimento é obrigatório." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const now = new Date().toISOString();
    const intake: LegalIntake = {
      id: `int-${Date.now()}`,
      account_id: user.accountId,
      unit_id: body.unit_id ?? user.unitId ?? null,
      contact_id: body.contact_id ?? null,
      conversation_id: body.conversation_id ?? null,
      client_entity_id: body.client_entity_id ?? null,
      assigned_user_id: body.assigned_user_id ?? user.userId,
      title: body.title.trim(),
      origin_channel: body.origin_channel ?? "whatsapp",
      practice_area: (body.practice_area ?? "civel") as PracticeArea,
      reported_urgency: body.reported_urgency ?? "media",
      queue_name: body.queue_name ?? "triagem_geral",
      business_hours_received: body.business_hours_received ?? true,
      sla_due_at:
        body.sla_due_at ??
        new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      stage: "triagem",
      summary: body.summary ?? null,
      opposing_party_name: body.opposing_party_name ?? null,
      opposing_party_document: body.opposing_party_document ?? null,
      proposal_value_cents: body.proposal_value_cents ?? null,
      proposal_summary: body.proposal_summary ?? null,
      conflict_status: "nao_verificado",
      converted_matter_id: null,
      reopened_count: 0,
      created_at: now,
      updated_at: now,
    };

    store.intakes.unshift(intake);
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "intake.create",
      resource_type: "legal_intake",
      resource_id: intake.id,
      outcome: "allowed",
      metadata: { origin_channel: intake.origin_channel, practice_area: intake.practice_area },
    });

    return NextResponse.json({ intake }, { status: 201 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireLegalPermission(request, "intake_inbox", "write");
    const body = (await request.json()) as {
      id: string;
      action: "update_stage" | "archive" | "reopen" | "convert" | "proposal";
      stage?: LegalIntake["stage"];
      reason?: string;
      proposal_value_cents?: number;
      proposal_summary?: string;
      idempotency_key?: string;
      matter_type?: MatterType;
      is_restricted?: boolean;
      lead_lawyer_user_id?: string;
    };

    const store = getLegalStore();
    const intake = store.intakes.find(
      (i) => i.id === body.id && i.account_id === user.accountId,
    );
    if (!intake) {
      return NextResponse.json(
        { error: "Oportunidade não encontrada neste escritório." },
        { status: 404 },
      );
    }

    const now = new Date().toISOString();

    if (body.action === "archive") {
      intake.stage = "arquivado";
      intake.archived_reason = body.reason ?? "Arquivado sem contratação";
      intake.updated_at = now;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "intake.archive",
        resource_type: "legal_intake",
        resource_id: intake.id,
        outcome: "allowed",
        reason: intake.archived_reason,
      });
      return NextResponse.json({ intake });
    }

    if (body.action === "reopen") {
      intake.stage = "triagem";
      intake.archived_reason = null;
      intake.reopened_count += 1;
      intake.updated_at = now;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "intake.reopen",
        resource_type: "legal_intake",
        resource_id: intake.id,
        outcome: "allowed",
        metadata: { reopened_count: intake.reopened_count },
      });
      return NextResponse.json({ intake });
    }

    if (body.action === "proposal") {
      intake.stage = "proposta";
      intake.proposal_value_cents = body.proposal_value_cents ?? intake.proposal_value_cents;
      intake.proposal_summary = body.proposal_summary ?? intake.proposal_summary;
      intake.updated_at = now;
      return NextResponse.json({ intake });
    }

    if (body.action === "update_stage" && body.stage) {
      intake.stage = body.stage;
      intake.updated_at = now;
      return NextResponse.json({ intake });
    }

    if (body.action === "convert") {
      await requireLegalPermission(request, "matters", "write");

      // Idempotência: se já convertida ou mesma chave usada, retorna pasta existente sem duplicar!
      if (intake.converted_matter_id) {
        const existingMatter = store.matters.find(
          (m) => m.id === intake.converted_matter_id,
        );
        return NextResponse.json({
          intake,
          matter: existingMatter ?? null,
          idempotentReplay: true,
        });
      }
      if (body.idempotency_key) {
        const dupIntake = store.intakes.find(
          (i) =>
            i.account_id === user.accountId &&
            i.conversion_idempotency_key === body.idempotency_key &&
            i.converted_matter_id,
        );
        if (dupIntake?.converted_matter_id) {
          const existingMatter = store.matters.find(
            (m) => m.id === dupIntake.converted_matter_id,
          );
          return NextResponse.json({
            intake: dupIntake,
            matter: existingMatter ?? null,
            idempotentReplay: true,
          });
        }
      }

      const policyBlock =
        store.governance[user.accountId]?.conflict_block_hiring ?? true;
      const hiringCheck = canProceedWithHiring(intake.conflict_status, policyBlock);
      if (!hiringCheck.allowed) {
        appendAuditEvent({
          account_id: user.accountId,
          actor_user_id: user.userId,
          actor_role: user.legalRole,
          operation: "intake.convert_blocked_conflict",
          resource_type: "legal_intake",
          resource_id: intake.id,
          outcome: "denied",
          reason: hiringCheck.reason,
        });
        return NextResponse.json(
          { error: hiringCheck.reason, code: "conflict_gate_blocked" },
          { status: 409 },
        );
      }

      const leadId = body.lead_lawyer_user_id ?? intake.assigned_user_id ?? user.userId;
      const isRestricted = Boolean(body.is_restricted);
      const clientEntity = intake.client_entity_id
        ? store.people.find((p) => p.id === intake.client_entity_id)
        : null;

      const matter: Matter = {
        id: `mat-${Date.now()}`,
        account_id: user.accountId,
        unit_id: intake.unit_id ?? user.unitId ?? null,
        team_id: user.teamIds[0] ?? null,
        origin_intake_id: intake.id,
        origin_conversation_id: intake.conversation_id ?? null,
        code: `PST-${new Date().getUTCFullYear()}-${String(store.matters.length + 1).padStart(3, "0")}`,
        title: intake.title,
        matter_type: body.matter_type ?? (intake.practice_area === "consultivo" ? "consultoria" : "judicial"),
        practice_area: intake.practice_area,
        status: "ativo",
        priority: intake.reported_urgency === "critica" ? "urgente" : intake.reported_urgency,
        object_description: intake.summary ?? null,
        restricted_strategy: null,
        next_step: "Concluir checklist de abertura e formalizar procuração/contrato.",
        claim_value_cents: intake.proposal_value_cents ?? null,
        lead_lawyer_user_id: leadId,
        is_restricted: isRestricted,
        confidentiality_level: isRestricted ? "sigiloso" : "interno",
        members: [
          {
            user_id: leadId,
            full_name: user.fullName,
            member_role: "responsavel",
            can_view_strategy: true,
            is_active: true,
          },
        ],
        access_grants: isRestricted
          ? [
              {
                user_id: leadId,
                access_level: "admin",
                granted_by_user_id: user.userId,
                reason: "Responsável na conversão da oportunidade em pasta restrita",
              },
            ]
          : [],
        parties: clientEntity
          ? [
              {
                id: `mp-${Date.now()}`,
                entity_id: clientEntity.id,
                entity_name: clientEntity.full_name,
                person_type: clientEntity.person_type,
                party_role: "cliente",
                is_primary: true,
                poa_registered: false,
              },
            ]
          : [],
        checklists: [
          {
            id: `mchk-${Date.now()}`,
            title: `Checklist de Abertura — ${intake.practice_area.toUpperCase()} (v1)`,
            practice_area: intake.practice_area,
            template_version: 1,
            items: (
              store.checklistCatalog[intake.practice_area] ??
              DEFAULT_CHECKLISTS_BY_AREA.civel
            ).map((label, idx) => ({
              id: `ci-${Date.now()}-${idx}`,
              label,
              required: idx < 2,
              done: false,
            })),
          },
        ],
        closure_checklist_completed: false,
        accountability_completed: false,
        client_delivery_approved: false,
        retention_policy_years: 5,
        created_at: now,
        updated_at: now,
      };

      store.matters.unshift(matter);
      intake.stage = "convertido";
      intake.converted_matter_id = matter.id;
      intake.conversion_idempotency_key =
        body.idempotency_key ?? `conv:${intake.id}`;
      intake.updated_at = now;

      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "intake.convert_to_matter",
        resource_type: "matter",
        resource_id: matter.id,
        outcome: "allowed",
        metadata: {
          intake_id: intake.id,
          idempotency_key: intake.conversion_idempotency_key,
          is_restricted: isRestricted,
        },
      });

      return NextResponse.json(
        { intake, matter, idempotentReplay: false },
        { status: 201 },
      );
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
