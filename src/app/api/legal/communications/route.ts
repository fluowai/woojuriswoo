import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { LegalCommunication } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "communications", "read");
    const store = getLegalStore();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const kind = searchParams.get("kind");

    let items = store.communications.filter((c) => c.account_id === user.accountId);
    if (status && status !== "all") items = items.filter((c) => c.queue_status === status);
    if (kind && kind !== "all") items = items.filter((c) => c.communication_kind === kind);

    return NextResponse.json({ communications: items, total: items.length });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "communications", "write");
    const body = (await request.json()) as Partial<LegalCommunication>;
    if (!body.summary?.trim()) {
      return NextResponse.json(
        { error: "Resumo da comunicação oficial é obrigatório." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const dedupHash = createHash("sha256")
      .update(
        `${user.accountId}|${body.source_name ?? "manual"}|${body.external_identifier ?? ""}|${body.publication_date ?? ""}|${body.summary.trim().toLowerCase()}`,
      )
      .digest("hex")
      .slice(0, 32);

    const existing = store.communications.find(
      (c) => c.account_id === user.accountId && c.dedup_hash === dedupHash,
    );
    if (existing) {
      return NextResponse.json(
        { communication: existing, duplicateDetected: true },
        { status: 200 },
      );
    }

    const comm: LegalCommunication = {
      id: `comm-${Date.now()}`,
      account_id: user.accountId,
      matter_id: body.matter_id ?? null,
      case_id: body.case_id ?? null,
      communication_kind: body.communication_kind ?? "publicacao",
      source_name: body.source_name ?? "manual",
      external_identifier: body.external_identifier ?? null,
      dedup_hash: dedupHash,
      official_link: body.official_link ?? null,
      available_date: body.available_date ?? null,
      publication_date: body.publication_date ?? null,
      acknowledgement_date: body.acknowledgement_date ?? null,
      collected_at: new Date().toISOString(),
      received_out_of_order: Boolean(body.received_out_of_order),
      queue_status: "nova",
      summary: body.summary.trim(),
      content_excerpt: body.content_excerpt ?? null,
    };

    store.communications.unshift(comm);
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "communication.ingest",
      resource_type: "legal_communication",
      resource_id: comm.id,
      outcome: "allowed",
      metadata: { kind: comm.communication_kind, source: comm.source_name },
    });

    return NextResponse.json({ communication: comm, duplicateDetected: false }, { status: 201 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireLegalPermission(request, "communications", "validate");
    const body = (await request.json()) as {
      id: string;
      queue_status: LegalCommunication["queue_status"];
      matter_id?: string | null;
      justification?: string;
    };

    const store = getLegalStore();
    const comm = store.communications.find(
      (c) => c.id === body.id && c.account_id === user.accountId,
    );
    if (!comm) {
      return NextResponse.json({ error: "Comunicação não encontrada." }, { status: 404 });
    }
    if (body.queue_status === "descartada" && (!body.justification || body.justification.trim().length < 5)) {
      return NextResponse.json(
        { error: "Descartar comunicação oficial exige justificativa registrada." },
        { status: 400 },
      );
    }

    comm.queue_status = body.queue_status;
    if (body.matter_id !== undefined) comm.matter_id = body.matter_id;
    if (body.justification) comm.disposition_justification = body.justification.trim();
    comm.reviewed_by_user_id = user.userId;
    comm.reviewed_at = new Date().toISOString();

    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: `communication.transition.${body.queue_status}`,
      resource_type: "legal_communication",
      resource_id: comm.id,
      outcome: "allowed",
      reason: comm.disposition_justification ?? undefined,
    });

    return NextResponse.json({ communication: comm });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
