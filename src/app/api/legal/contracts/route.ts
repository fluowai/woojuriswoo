import { NextResponse } from "next/server";
import {
  processSignatureWebhookEvent,
  transitionContractStatus,
  verifySignatureWebhookHmac,
} from "@/lib/legal/documents-contracts";
import { generateReceivablesForContract } from "@/lib/legal/finance";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { ContractStatus, LegalContract } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "contracts", "read");
    const store = getLegalStore();
    return NextResponse.json({
      contracts: store.contracts.filter((c) => c.account_id === user.accountId),
      signatureProviderMode:
        process.env.DOCUMENSO_API_URL && process.env.DOCUMENSO_API_KEY
          ? "producao"
          : "homologacao",
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "contracts", "write");
    const body = (await request.json()) as Partial<LegalContract>;
    if (!body.matter_id || !body.title?.trim() || !body.scope_description?.trim()) {
      return NextResponse.json(
        { error: "Pasta, título e escopo contratual são obrigatórios." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const contract: LegalContract = {
      id: `ctr-${Date.now()}`,
      account_id: user.accountId,
      matter_id: body.matter_id,
      parent_contract_id: body.parent_contract_id ?? null,
      contract_number: `CTR-${new Date().getUTCFullYear()}-${String(store.contracts.length + 1).padStart(3, "0")}`,
      title: body.title.trim(),
      contract_kind: body.contract_kind ?? "honorarios",
      scope_description: body.scope_description.trim(),
      fee_model: body.fee_model ?? "parcelado",
      total_value_cents: Math.max(0, Math.round(Number(body.total_value_cents ?? 0))),
      installments_count: Math.max(1, Number(body.installments_count ?? 1)),
      success_fee_percent: body.success_fee_percent ?? null,
      success_fee_condition: body.success_fee_condition ?? null,
      success_condition_validated: false,
      signature_method: body.signature_method ?? "manual_comprovado",
      signature_provider: body.signature_provider ?? "manual",
      status: "rascunho",
      receivables_generated: false,
      signers: body.signers ?? [],
      created_at: new Date().toISOString(),
    };

    store.contracts.unshift(contract);
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "contract.create",
      resource_type: "contract",
      resource_id: contract.id,
      outcome: "allowed",
    });

    return NextResponse.json({ contract }, { status: 201 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id: string;
      action: "transition" | "generate_receivables";
      nextStatus?: ContractStatus;
      manualEvidenceNote?: string;
      manualEvidenceHash?: string;
      firstDueDate?: string;
    };

    const requiredAction =
      body.action === "transition" &&
      (body.nextStatus === "aprovado" || body.nextStatus === "assinado")
        ? "approve"
        : "write";
    const user = await requireLegalPermission(request, "contracts", requiredAction);
    const store = getLegalStore();
    const idx = store.contracts.findIndex(
      (c) => c.id === body.id && c.account_id === user.accountId,
    );
    if (idx < 0) {
      return NextResponse.json({ error: "Contrato não encontrado." }, { status: 404 });
    }

    const current = store.contracts[idx];

    if (body.action === "transition" && body.nextStatus) {
      const res = transitionContractStatus(current, body.nextStatus, {
        manualEvidenceHash: body.manualEvidenceHash,
        manualEvidenceNote: body.manualEvidenceNote,
      });
      if (!res.ok) {
        return NextResponse.json({ error: res.error }, { status: 400 });
      }
      store.contracts[idx] = res.contract;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: `contract.status.${body.nextStatus}`,
        resource_type: "contract",
        resource_id: current.id,
        outcome: "allowed",
      });
      return NextResponse.json({ contract: res.contract });
    }

    if (body.action === "generate_receivables") {
      const officeFund = store.fundAccounts.find(
        (f) =>
          f.account_id === user.accountId &&
          f.account_kind === "escritorio_propria",
      );
      const gen = generateReceivablesForContract({
        contract: current,
        existingReceivables: store.receivables,
        officeFundAccountId: officeFund?.id ?? "fund-office-01",
        firstDueDate: body.firstDueDate ?? new Date().toISOString().slice(0, 10),
      });
      if (!gen.ok) {
        return NextResponse.json({ error: gen.error }, { status: 400 });
      }
      if (gen.created) {
        store.receivables.unshift(gen.receivable);
        current.receivables_generated = true;
      }
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "contract.generate_receivables",
        resource_type: "receivable",
        resource_id: gen.receivable.id,
        outcome: "allowed",
        metadata: { created: gen.created, idempotentReplay: !gen.created },
      });
      return NextResponse.json({
        contract: current,
        receivable: gen.receivable,
        created: gen.created,
      });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Endpoint webhook de assinatura eletrônica (HMAC + proteção contra replay e fora de ordem)
export async function PUT(request: Request) {
  try {
    const rawBody = await request.text();
    const secret = process.env.DOCUMENSO_WEBHOOK_SECRET || "homologacao-documenso-secret";
    const sig = request.headers.get("x-signature-sha256");

    if (!verifySignatureWebhookHmac(rawBody, sig, secret)) {
      return NextResponse.json(
        { error: "Assinatura HMAC do webhook inválida." },
        { status: 401 },
      );
    }

    const payload = JSON.parse(rawBody) as {
      contractId: string;
      eventId: string;
      eventType: "DOCUMENT_SENT" | "DOCUMENT_SIGNED" | "DOCUMENT_REJECTED" | "DOCUMENT_EXPIRED";
      occurredAt: string;
    };

    const store = getLegalStore();
    const idx = store.contracts.findIndex((c) => c.id === payload.contractId);
    if (idx < 0) {
      return NextResponse.json({ error: "Contrato não encontrado." }, { status: 404 });
    }

    const processed = processSignatureWebhookEvent({
      contract: store.contracts[idx],
      processedEventIds: store.processedWebhookEvents,
      eventId: payload.eventId,
      eventType: payload.eventType,
      occurredAt: payload.occurredAt,
    });
    store.contracts[idx] = processed.contract;

    return NextResponse.json({
      outcome: processed.outcome,
      contract: processed.contract,
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
