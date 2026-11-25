import { NextResponse } from "next/server";
import { evaluateMatterAccess } from "@/lib/legal/authz";
import {
  renderDocumentTemplate,
  validateAndHashUpload,
} from "@/lib/legal/documents-contracts";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { LegalDocument } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "documents", "read");
    const store = getLegalStore();

    // Só retorna documentos cujas pastas o usuário tem autorização para acessar
    const allowedMatterIds = new Set(
      store.matters
        .filter(
          (m) =>
            m.account_id === user.accountId &&
            evaluateMatterAccess(user, m, store.breakGlassGrants).allowed,
        )
        .map((m) => m.id),
    );

    const documents = store.documents.filter(
      (d) => d.account_id === user.accountId && allowedMatterIds.has(d.matter_id),
    );
    const templates = store.templates.filter(
      (t) => t.account_id === user.accountId,
    );

    return NextResponse.json({ documents, templates });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Upload com validação de quarentena e SHA-256
export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "documents", "write");
    const body = (await request.json()) as {
      matter_id: string;
      title: string;
      category?: LegalDocument["category"];
      confidentiality_level?: LegalDocument["confidentiality_level"];
      filename: string;
      mime_type: string;
      content_sample?: string;
      tags?: string[];
    };

    const store = getLegalStore();
    const matter = store.matters.find(
      (m) => m.id === body.matter_id && m.account_id === user.accountId,
    );
    if (!matter || !evaluateMatterAccess(user, matter, store.breakGlassGrants).allowed) {
      return NextResponse.json(
        { error: "Pasta jurídica não encontrada ou sem autorização de acesso." },
        { status: 403 },
      );
    }

    const check = validateAndHashUpload({
      filename: body.filename ?? "documento.pdf",
      mimeType: body.mime_type ?? "application/pdf",
      content: body.content_sample ?? `conteudo-sintetico:${body.title}:${Date.now()}`,
    });

    if (!check.valid) {
      return NextResponse.json(
        { error: check.errors.join(" "), quarantineStatus: check.quarantineStatus },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const doc: LegalDocument = {
      id: `doc-${Date.now()}`,
      account_id: user.accountId,
      matter_id: matter.id,
      title: body.title?.trim() || body.filename,
      category: body.category ?? "peca",
      confidentiality_level: body.confidentiality_level ?? "interno",
      quarantine_status: "quarentena", // Sempre entra em quarentena até validação isolada
      tags: body.tags ?? ["upload"],
      portal_published: false,
      versions: [
        {
          version_number: 1,
          artifact_kind: "original",
          filename: body.filename,
          mime_type: body.mime_type,
          size_bytes: Buffer.byteLength(body.content_sample ?? "synthetic", "utf8"),
          sha256_hash: check.sha256,
          storage_path: `account-${user.accountId}/${matter.id}/${body.filename}`,
          origin_source: "upload_manual",
          ocr_status: body.mime_type === "application/pdf" ? "homologacao" : "nao_aplicavel",
          created_at: now,
        },
      ],
      created_at: now,
    };

    store.documents.unshift(doc);
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "document.upload_quarantine",
      resource_type: "document",
      resource_id: doc.id,
      outcome: "allowed",
      metadata: { matter_id: matter.id, sha256: check.sha256 },
    });

    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Aprovação de quarentena, publicação no portal ou renderização de modelo versionado
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      action: "approve_quarantine" | "publish_portal" | "render_template";
      documentId?: string;
      templateId?: string;
      values?: Record<string, string>;
    };

    const store = getLegalStore();

    if (body.action === "render_template" && body.templateId) {
      const user = await requireLegalPermission(request, "documents", "read");
      const tpl = store.templates.find(
        (t) => t.id === body.templateId && t.account_id === user.accountId,
      );
      if (!tpl) {
        return NextResponse.json({ error: "Modelo não encontrado." }, { status: 404 });
      }
      const rendered = renderDocumentTemplate(tpl, body.values ?? {});
      if (!rendered.ok) {
        return NextResponse.json({ error: rendered.errors.join(" | "), errors: rendered.errors }, { status: 400 });
      }
      return NextResponse.json({
        rendered: rendered.rendered,
        sha256: rendered.sha256,
        pdfAdapterMode: process.env.GOTENBERG_URL ? "producao" : "homologacao",
        templateVersion: tpl.current_version,
      });
    }

    const user = await requireLegalPermission(request, "documents", "approve");
    const doc = store.documents.find(
      (d) => d.id === body.documentId && d.account_id === user.accountId,
    );
    if (!doc) {
      return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
    }

    if (body.action === "approve_quarantine") {
      doc.quarantine_status = "aprovado";
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "document.approve_quarantine",
        resource_type: "document",
        resource_id: doc.id,
        outcome: "allowed",
      });
      return NextResponse.json({ document: doc });
    }

    if (body.action === "publish_portal") {
      if (doc.quarantine_status !== "aprovado") {
        return NextResponse.json(
          { error: "Documento ainda em quarentena não pode ser publicado no portal." },
          { status: 409 },
        );
      }
      doc.confidentiality_level = "publico_portal";
      doc.portal_published = true;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "document.publish_portal",
        resource_type: "document",
        resource_id: doc.id,
        outcome: "allowed",
      });
      return NextResponse.json({ document: doc });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
