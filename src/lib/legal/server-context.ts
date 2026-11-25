// ============================================================
// WooJuris — Contexto de Servidor e Guarda de Autorização
//
// Integra o contexto Supabase real (`getCurrentAccount`) com suporte
// transparente de homologação (quando o usuário testa os 9 perfis ou
// ainda não há projeto Supabase conectado) — sempre exigindo sessão
// válida em produção e aplicando RBAC + Sigilo + Auditoria no backend.
// ============================================================

import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/account";
import {
  canPerform,
  mapAccountRoleToLegalRole,
  type LegalAction,
  type LegalResource,
} from "./authz";
import { appendAuditEvent, DEMO_ACCOUNTS, DEMO_USERS } from "./store";
import type { LegalRole, LegalUserContext } from "./types";
import { LEGAL_ROLES } from "./types";

export class LegalHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "LegalHttpError";
  }
}

export function isHomologationDemoMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return (
    process.env.WOOJURIS_HOMOLOGATION_MODE === "true" ||
    !url ||
    url.includes("your-project.supabase.co")
  );
}

/**
 * Resolve o usuário jurídico autenticado para rotas `/api/legal/*`.
 * Em produção (Supabase configurado), autentica exclusivamente via cookies Supabase.
 * Em ambiente de homologação/testes, aceita o cabeçalho `x-woojuris-demo-user`
 * (ou `x-woojuris-demo-role`) para exercitar todos os 9 perfis e 2 escritórios isolados.
 */
export async function resolveLegalUser(
  request: Request,
): Promise<LegalUserContext> {
  const demoUserHeader = request.headers.get("x-woojuris-demo-user");
  const demoRoleHeader = request.headers.get("x-woojuris-demo-role");

  if (!isHomologationDemoMode()) {
    try {
      const ctx = await getCurrentAccount();
      // Em produção, permite override de perfil apenas se o usuário já estiver
      // autenticado e o perfil salvo na tabela profiles corresponder.
      const { data: profileRow } = await ctx.supabase
        .from("profiles")
        .select("full_name, email, legal_role, oab_number, unit_id, mfa_enrolled_at")
        .eq("user_id", ctx.userId)
        .maybeSingle();

      const legalRole = mapAccountRoleToLegalRole(
        ctx.role,
        (profileRow?.legal_role as LegalRole | null) ?? null,
      );

      return {
        userId: ctx.userId,
        accountId: ctx.accountId,
        legalRole,
        fullName: profileRow?.full_name ?? "Usuário",
        email: profileRow?.email ?? "",
        unitId: profileRow?.unit_id ?? null,
        teamIds: [],
        oabNumber: profileRow?.oab_number ?? null,
        mfaEnrolled: Boolean(profileRow?.mfa_enrolled_at),
      };
    } catch {
      throw new LegalHttpError(
        401,
        "unauthorized",
        "Sessão autenticada obrigatória para acessar recursos jurídicos.",
      );
    }
  }

  // Modo homologação / testes sem Supabase provisionado
  if (demoUserHeader && DEMO_USERS[demoUserHeader]) {
    return DEMO_USERS[demoUserHeader];
  }

  if (
    demoRoleHeader &&
    (LEGAL_ROLES as readonly string[]).includes(demoRoleHeader)
  ) {
    const found = Object.values(DEMO_USERS).find(
      (u) =>
        u.legalRole === demoRoleHeader &&
        u.accountId === DEMO_ACCOUNTS.WOOTECH_SC,
    );
    if (found) return found;
  }

  return DEMO_USERS["user-socio-1"];
}

export async function requireLegalPermission(
  request: Request,
  resource: LegalResource,
  action: LegalAction,
): Promise<LegalUserContext> {
  const user = await resolveLegalUser(request);
  const correlationId =
    request.headers.get("x-correlation-id") ?? `req-${Date.now()}`;

  if (!canPerform(user, resource, action)) {
    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: `${resource}.${action}`,
      resource_type: resource,
      outcome: "denied",
      reason: `Perfil "${user.legalRole}" sem permissão "${action}" em "${resource}".`,
      correlation_id: correlationId,
    });
    throw new LegalHttpError(
      403,
      "forbidden",
      `Acesso negado: perfil "${user.legalRole}" não tem permissão de "${action}" em "${resource}".`,
    );
  }

  return user;
}

export function legalErrorResponse(err: unknown): NextResponse {
  if (err instanceof LegalHttpError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status },
    );
  }
  console.error("[legalErrorResponse] erro interno não classificado");
  return NextResponse.json(
    { error: "Erro interno ao processar operação jurídica.", code: "internal_error" },
    { status: 500 },
  );
}
