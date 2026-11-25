import { NextResponse } from "next/server";
import {
  appendAuditEvent,
  getIntegrationsStatus,
  getLegalStore,
} from "@/lib/legal/store";
import {
  isHomologationDemoMode,
  legalErrorResponse,
  requireLegalPermission,
  resolveLegalUser,
} from "@/lib/legal/server-context";

export async function GET(request: Request) {
  try {
    const user = await resolveLegalUser(request);
    const store = getLegalStore();
    const governance = store.governance[user.accountId] ?? null;

    return NextResponse.json({
      ok: true,
      mode: isHomologationDemoMode() ? "homologacao" : "producao",
      brand: governance?.brand_name ?? process.env.NEXT_PUBLIC_BRAND_NAME ?? "WooJuris",
      user,
      governance,
      integrations: getIntegrationsStatus(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireLegalPermission(request, "office_settings", "write");
    const body = (await request.json()) as Record<string, unknown>;
    const store = getLegalStore();
    const current = store.governance[user.accountId];
    if (!current) {
      return NextResponse.json({ error: "Escritório não encontrado." }, { status: 404 });
    }

    const updated = {
      ...current,
      brand_name: typeof body.brand_name === "string" ? body.brand_name.trim() || current.brand_name : current.brand_name,
      legal_name: typeof body.legal_name === "string" ? body.legal_name.trim() : current.legal_name,
      timezone: typeof body.timezone === "string" ? body.timezone.trim() : current.timezone,
      oab_compliance_mode:
        typeof body.oab_compliance_mode === "boolean"
          ? body.oab_compliance_mode
          : current.oab_compliance_mode,
      broadcasts_enabled:
        typeof body.broadcasts_enabled === "boolean"
          ? body.broadcasts_enabled
          : current.broadcasts_enabled,
      ai_autonomous_disabled:
        typeof body.ai_autonomous_disabled === "boolean"
          ? body.ai_autonomous_disabled
          : current.ai_autonomous_disabled,
      mcp_enabled:
        typeof body.mcp_enabled === "boolean" ? body.mcp_enabled : current.mcp_enabled,
      api_keys_broad_enabled:
        typeof body.api_keys_broad_enabled === "boolean"
          ? body.api_keys_broad_enabled
          : current.api_keys_broad_enabled,
      conflict_block_hiring:
        typeof body.conflict_block_hiring === "boolean"
          ? body.conflict_block_hiring
          : current.conflict_block_hiring,
    };

    store.governance[user.accountId] = updated;
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "office_settings.update",
      resource_type: "account",
      resource_id: user.accountId,
      outcome: "allowed",
      metadata: {
        oab_compliance_mode: updated.oab_compliance_mode,
        broadcasts_enabled: updated.broadcasts_enabled,
        ai_autonomous_disabled: updated.ai_autonomous_disabled,
        mcp_enabled: updated.mcp_enabled,
      },
    });

    return NextResponse.json({ governance: updated });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
