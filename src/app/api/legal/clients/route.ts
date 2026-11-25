import { NextResponse } from "next/server";
import { maskDocument } from "@/lib/legal/authz";
import { normalizeDocumentId, normalizeText } from "@/lib/legal/conflicts";
import { executeCsvImportIdempotent, parseCsvAssisted } from "@/lib/legal/portal-reports-ai";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { PersonEntity } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "clients", "read");
    const store = getLegalStore();
    const { searchParams } = new URL(request.url);
    const q = normalizeText(searchParams.get("q") ?? "");
    const type = searchParams.get("type");

    let people = store.people.filter(
      (p) => p.account_id === user.accountId && !p.merged_into_id,
    );
    if (type === "PF" || type === "PJ") {
      people = people.filter((p) => p.person_type === type);
    }
    if (q) {
      people = people.filter(
        (p) =>
          p.normalized_name.includes(q) ||
          (p.cpf_cnpj_normalized ?? "").includes(q.replace(/\D/g, "") || "___") ||
          (p.phone ?? "").includes(q) ||
          p.aliases.some((a) => normalizeText(a).includes(q)),
      );
    }

    // Mascaramento preventivo em listagens (minimização LGPD)
    const sanitized = people.map((p) => ({
      ...p,
      cpf_cnpj_masked: maskDocument(p.cpf_cnpj),
    }));

    return NextResponse.json({ clients: sanitized, total: sanitized.length });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "clients", "write");
    const body = (await request.json()) as Partial<PersonEntity>;
    if (!body.full_name?.trim()) {
      return NextResponse.json(
        { error: "Nome completo ou razão social é obrigatório." },
        { status: 400 },
      );
    }

    const store = getLegalStore();
    const docNorm = normalizeDocumentId(body.cpf_cnpj);
    const entity: PersonEntity = {
      id: `ent-${Date.now()}`,
      account_id: user.accountId,
      person_type: body.person_type === "PJ" ? "PJ" : "PF",
      full_name: body.full_name.trim(),
      normalized_name: normalizeText(body.full_name),
      aliases: Array.isArray(body.aliases) ? body.aliases : [],
      cpf_cnpj: body.cpf_cnpj ?? null,
      cpf_cnpj_normalized: docNorm || null,
      oab_number: body.oab_number ?? null,
      economic_group: body.economic_group ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      is_client: body.is_client ?? true,
      is_confidential: body.is_confidential ?? false,
      shared_phone_flag: body.shared_phone_flag ?? false,
      communication_purpose:
        body.communication_purpose ?? "Atendimento jurídico autorizado",
      authorized_channels: body.authorized_channels ?? ["whatsapp", "email"],
      created_at: new Date().toISOString(),
    };

    store.people.unshift(entity);
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "client.create",
      resource_type: "person_entity",
      resource_id: entity.id,
      outcome: "allowed",
      metadata: { person_type: entity.person_type, is_confidential: entity.is_confidential },
    });

    return NextResponse.json({ client: entity }, { status: 201 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Unificação revisável de duplicatas preservando vínculos e números compartilhados
export async function PATCH(request: Request) {
  try {
    const user = await requireLegalPermission(request, "clients", "write");
    const body = (await request.json()) as {
      sourceId: string;
      targetId: string;
      reason?: string;
    };
    const store = getLegalStore();
    const source = store.people.find(
      (p) => p.id === body.sourceId && p.account_id === user.accountId,
    );
    const target = store.people.find(
      (p) => p.id === body.targetId && p.account_id === user.accountId,
    );
    if (!source || !target || source.id === target.id) {
      return NextResponse.json(
        { error: "Selecione dois cadastros distintos do mesmo escritório para unificar." },
        { status: 400 },
      );
    }

    source.merged_into_id = target.id;
    target.aliases = Array.from(new Set([...target.aliases, source.full_name, ...source.aliases]));

    // Reponta vínculos em pastas preservando histórico
    for (const m of store.matters) {
      if (m.account_id !== user.accountId) continue;
      for (const party of m.parties) {
        if (party.entity_id === source.id) {
          party.entity_id = target.id;
          party.entity_name = target.full_name;
        }
      }
    }

    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "client.merge_duplicates",
      resource_type: "person_entity",
      resource_id: target.id,
      outcome: "allowed",
      reason: body.reason ?? "Unificação revisada de duplicata",
      metadata: { merged_source_id: source.id },
    });

    return NextResponse.json({ mergedInto: target });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Importação CSV assistida com prévia e deduplicação
export async function PUT(request: Request) {
  try {
    const user = await requireLegalPermission(request, "clients", "write");
    const body = (await request.json()) as {
      csvText: string;
      mode: "preview" | "execute";
    };
    const store = getLegalStore();

    if (body.mode === "preview") {
      const parsed = parseCsvAssisted(
        body.csvText ?? "",
        ["nome", "tipo"],
        "documento",
      );
      return NextResponse.json({
        previewRows: parsed.rows.slice(0, 20),
        totalValidRows: parsed.rows.length,
        inconsistencies: parsed.inconsistencies,
        fileSha256: parsed.fileSha256,
      });
    }

    const existingKeys = new Set(
      store.people
        .filter((p) => p.account_id === user.accountId)
        .map((p) => (p.cpf_cnpj_normalized || p.normalized_name).toLowerCase()),
    );

    const parsed = parseCsvAssisted(
      body.csvText ?? "",
      ["nome", "tipo"],
      "documento",
    );
    const batch = executeCsvImportIdempotent({
      targetModule: "clients",
      csvText: body.csvText ?? "",
      requiredColumns: ["nome", "tipo"],
      dedupKeyColumn: "documento",
      existingKeys,
    });

    for (const row of parsed.rows) {
      if (!batch.importedKeys.includes(row.key)) continue;
      store.people.unshift({
        id: `ent-csv-${Date.now()}-${row.rowNumber}`,
        account_id: user.accountId,
        person_type: row.data.tipo?.toUpperCase() === "PJ" ? "PJ" : "PF",
        full_name: row.data.nome,
        normalized_name: normalizeText(row.data.nome),
        aliases: [],
        cpf_cnpj: row.data.documento || null,
        cpf_cnpj_normalized: normalizeDocumentId(row.data.documento) || null,
        email: row.data.email || null,
        phone: row.data.telefone || null,
        is_client: true,
        is_confidential: false,
        created_at: new Date().toISOString(),
      });
    }

    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "clients.csv_import",
      resource_type: "csv_import_batch",
      resource_id: batch.batchId,
      outcome: "allowed",
      metadata: {
        imported: batch.importedKeys.length,
        duplicatesSkipped: batch.duplicatesSkipped,
        inconsistencies: batch.inconsistencies.length,
      },
    });

    return NextResponse.json({ batch });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
