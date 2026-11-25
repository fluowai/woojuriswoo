import { NextResponse } from "next/server";
import { evaluateMatterAccess, sanitizeMatterForUser } from "@/lib/legal/authz";
import {
  appendAuditEvent,
  DEFAULT_CHECKLISTS_BY_AREA,
  getLegalStore,
} from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { Matter, MatterType, PracticeArea } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "matters", "read");
    const store = getLegalStore();
    const { searchParams } = new URL(request.url);
    const area = searchParams.get("area");
    const type = searchParams.get("type");
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();

    // Filtra rigorosamente por isolamento multi-tenant + barreira de sigilo
    const visible: Matter[] = [];
    let hiddenRestrictedCount = 0;

    for (const matter of store.matters) {
      if (matter.account_id !== user.accountId) continue;
      const decision = evaluateMatterAccess(user, matter, store.breakGlassGrants);
      if (!decision.allowed) {
        if (matter.is_restricted) hiddenRestrictedCount++;
        continue;
      }
      const sanitized = sanitizeMatterForUser(matter, decision);
      if (area && area !== "all" && sanitized.practice_area !== area) continue;
      if (type && type !== "all" && sanitized.matter_type !== type) continue;
      if (
        q &&
        !sanitized.title.toLowerCase().includes(q) &&
        !sanitized.code.toLowerCase().includes(q)
      ) {
        continue;
      }
      visible.push(sanitized);
    }

    return NextResponse.json({
      matters: visible,
      total: visible.length,
      hiddenRestrictedCount,
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "matters", "write");
    const body = (await request.json()) as {
      title: string;
      matter_type?: MatterType;
      practice_area?: PracticeArea;
      priority?: Matter["priority"];
      object_description?: string;
      restricted_strategy?: string;
      claim_value_cents?: number | null;
      is_restricted?: boolean;
      client_entity_id?: string | null;
    };

    if (!body.title?.trim()) {
      return NextResponse.json(
        { error: "Título da pasta jurídica é obrigatório." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const now = new Date().toISOString();
    const area: PracticeArea = body.practice_area ?? "civel";
    const isRestricted = Boolean(body.is_restricted);
    const clientEntity = body.client_entity_id
      ? store.people.find(
          (p) => p.id === body.client_entity_id && p.account_id === user.accountId,
        )
      : null;

    const matter: Matter = {
      id: `mat-${Date.now()}`,
      account_id: user.accountId,
      unit_id: user.unitId ?? null,
      team_id: user.teamIds[0] ?? null,
      code: `PST-${new Date().getUTCFullYear()}-${String(store.matters.length + 1).padStart(3, "0")}`,
      title: body.title.trim(),
      matter_type: body.matter_type ?? "extrajudicial",
      practice_area: area,
      status: "ativo",
      priority: body.priority ?? "media",
      object_description: body.object_description ?? null,
      restricted_strategy: body.restricted_strategy ?? null,
      next_step: "Definir plano de atuação e revisar documentos iniciais.",
      claim_value_cents: body.claim_value_cents ?? null,
      lead_lawyer_user_id: user.userId,
      is_restricted: isRestricted,
      confidentiality_level: isRestricted ? "sigiloso" : "interno",
      members: [
        {
          user_id: user.userId,
          full_name: user.fullName,
          member_role: "responsavel",
          can_view_strategy: true,
          is_active: true,
        },
      ],
      access_grants: isRestricted
        ? [
            {
              user_id: user.userId,
              access_level: "admin",
              granted_by_user_id: user.userId,
              reason: "Criador e responsável inicial da pasta restrita",
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
          title: `Checklist — ${area.toUpperCase()} (v1)`,
          practice_area: area,
          template_version: 1,
          items: (
            store.checklistCatalog[area] ?? DEFAULT_CHECKLISTS_BY_AREA.civel
          ).map((label, i) => ({
            id: `ci-${Date.now()}-${i}`,
            label,
            required: i < 2,
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
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "matter.create",
      resource_type: "matter",
      resource_id: matter.id,
      outcome: "allowed",
      metadata: { matter_type: matter.matter_type, is_restricted: isRestricted },
    });

    return NextResponse.json({ matter }, { status: 201 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
