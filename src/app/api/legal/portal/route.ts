import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { canExposeDocumentToPortal } from "@/lib/legal/documents-contracts";
import { resolvePortalAccess } from "@/lib/legal/portal-reports-ai";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { PortalInvitation, PortalPublication } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const store = getLegalStore();

    // Acesso público autenticado por convite/token do Portal do Cliente
    if (token) {
      const invitation = store.portalInvitations.find((i) => i.token === token);
      const resolved = resolvePortalAccess(invitation, store.portalPublications);
      if (!resolved.allowed) {
        return NextResponse.json(
          { error: resolved.reason, code: "portal_access_denied" },
          { status: 403 },
        );
      }

      const matter = store.matters.find((m) => m.id === resolved.invitation.matter_id);
      const publishedDocs = store.documents.filter(
        (d) =>
          d.matter_id === resolved.invitation.matter_id &&
          canExposeDocumentToPortal(d).allowed,
      );
      const contracts = store.contracts
        .filter((c) => c.matter_id === resolved.invitation.matter_id && c.status !== "rascunho")
        .map((c) => ({
          id: c.id,
          contract_number: c.contract_number,
          title: c.title,
          status: c.status,
          total_value_cents: c.total_value_cents,
          signed_at: c.signed_at,
        }));
      const receivables = store.receivables
        .filter((r) => r.matter_id === resolved.invitation.matter_id)
        .map((r) => ({
          id: r.id,
          description: r.description,
          total_cents: r.total_cents,
          paid_cents: r.paid_cents,
          status: r.status,
          installments: r.installments,
        }));

      return NextResponse.json({
        invitation: {
          entity_name: resolved.invitation.entity_name,
          scope_role: resolved.invitation.scope_role,
          expires_at: resolved.invitation.expires_at,
        },
        matterSummary: matter
          ? {
              code: matter.code,
              title: matter.title,
              practice_area: matter.practice_area,
              status: matter.status,
            }
          : null,
        publications: resolved.visiblePublications,
        documents: publishedDocs,
        contracts,
        receivables,
      });
    }

    // Visão administrativa do escritório
    const user = await requireLegalPermission(request, "portal_admin", "read");
    return NextResponse.json({
      invitations: store.portalInvitations.filter(
        (i) => i.account_id === user.accountId,
      ),
      publications: store.portalPublications.filter(
        (p) => p.account_id === user.accountId,
      ),
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "portal_admin", "publish");
    const body = (await request.json()) as
      | {
          kind: "invitation";
          matterId: string;
          entityId: string;
          scopeRole?: "cliente" | "representante";
          expiresDays?: number;
        }
      | {
          kind: "publication";
          matterId: string;
          publicationType: PortalPublication["publication_type"];
          title: string;
          body: string;
          containsSensitiveInfo?: boolean;
          publishNow?: boolean;
        };

    const store = getLegalStore();

    if (body.kind === "invitation") {
      const entity = store.people.find(
        (p) => p.id === body.entityId && p.account_id === user.accountId,
      );
      if (!entity) {
        return NextResponse.json({ error: "Cliente/representante não encontrado." }, { status: 404 });
      }
      const expiresDays = Math.max(1, Math.min(body.expiresDays ?? 30, 365));
      const inv: PortalInvitation = {
        id: `pinv-${Date.now()}`,
        account_id: user.accountId,
        matter_id: body.matterId,
        entity_id: entity.id,
        entity_name: entity.full_name,
        token: `wj-${randomBytes(12).toString("hex")}`,
        scope_role: body.scopeRole ?? "cliente",
        is_revoked: false,
        expires_at: new Date(Date.now() + expiresDays * 86_400_000).toISOString(),
      };
      store.portalInvitations.unshift(inv);
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "portal.create_invitation",
        resource_type: "portal_invitation",
        resource_id: inv.id,
        outcome: "allowed",
      });
      return NextResponse.json({ invitation: inv }, { status: 201 });
    }

    if (body.kind === "publication") {
      if (!body.title?.trim() || !body.body?.trim()) {
        return NextResponse.json(
          { error: "Título e texto da publicação são obrigatórios." },
          { status: 400 },
        );
      }
      const canApproveSensitive =
        user.legalRole === "partner_admin" ||
        user.legalRole === "coordinator" ||
        user.legalRole === "lawyer";

      if (body.containsSensitiveInfo && !canApproveSensitive) {
        return NextResponse.json(
          { error: "Publicação com informação sensível exige aprovação de advogado/coordenador." },
          { status: 403 },
        );
      }

      const pub: PortalPublication = {
        id: `ppub-${Date.now()}`,
        account_id: user.accountId,
        matter_id: body.matterId,
        publication_type: body.publicationType ?? "andamento",
        title: body.title.trim(),
        body: body.body.trim(),
        contains_sensitive_info: Boolean(body.containsSensitiveInfo),
        approved_by_user_id: canApproveSensitive ? user.userId : null,
        published_at: body.publishNow !== false ? new Date().toISOString() : null,
      };
      store.portalPublications.unshift(pub);
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "portal.publish",
        resource_type: "portal_publication",
        resource_id: pub.id,
        outcome: "allowed",
      });
      return NextResponse.json({ publication: pub }, { status: 201 });
    }

    return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Revogação imediata de convite/representação ou publicação
export async function PATCH(request: Request) {
  try {
    const user = await requireLegalPermission(request, "portal_admin", "write");
    const body = (await request.json()) as {
      action: "revoke_invitation" | "revoke_publication";
      id: string;
    };

    const store = getLegalStore();
    const now = new Date().toISOString();

    if (body.action === "revoke_invitation") {
      const inv = store.portalInvitations.find(
        (i) => i.id === body.id && i.account_id === user.accountId,
      );
      if (!inv) {
        return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
      }
      inv.is_revoked = true;
      inv.revoked_at = now;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "portal.revoke_invitation",
        resource_type: "portal_invitation",
        resource_id: inv.id,
        outcome: "allowed",
      });
      return NextResponse.json({ invitation: inv });
    }

    if (body.action === "revoke_publication") {
      const pub = store.portalPublications.find(
        (p) => p.id === body.id && p.account_id === user.accountId,
      );
      if (!pub) {
        return NextResponse.json({ error: "Publicação não encontrada." }, { status: 404 });
      }
      pub.revoked_at = now;
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "portal.revoke_publication",
        resource_type: "portal_publication",
        resource_id: pub.id,
        outcome: "allowed",
      });
      return NextResponse.json({ publication: pub });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
