// ============================================================
// WooJuris — Motor de Autorização (RBAC + ABAC + Sigilo)
//
// Regra absoluta:
// 1. Isolamento de tenant (`accountId`).
// 2. Barreira de sigilo (`matter.is_restricted === true`) tem
//    PRECEDÊNCIA ABSOLUTA — mesmo `partner_admin` sem grant explícito
//    ou vínculo ativo em `matter.members` é NEGADO.
// 3. `platform_ops` não tem acesso rotineiro às pastas; exige
//    `BreakGlassGrant` válido, não revogado e não expirado.
// 4. Redação obrigatória de PII/segredos em logs.
// ============================================================

import type {
  BreakGlassGrant,
  LegalRole,
  LegalUserContext,
  Matter,
} from "./types";
import type { AccountRole } from "@/lib/auth/roles";

export type LegalResource =
  | "saas_platform"
  | "office_settings"
  | "team_management"
  | "intake_inbox"
  | "clients"
  | "conflicts"
  | "matters"
  | "matter_strategy"
  | "cases"
  | "communications"
  | "deadlines"
  | "agenda"
  | "documents"
  | "contracts"
  | "finance"
  | "portal_admin"
  | "portal_client"
  | "reports"
  | "audit"
  | "lgpd_dsar"
  | "ai_assist";

export type LegalAction =
  | "read"
  | "write"
  | "approve"
  | "validate"
  | "publish"
  | "reverse"
  | "export"
  | "manage";

const ROLE_MATRIX: Record<LegalRole, Partial<Record<LegalResource, LegalAction[]>>> = {
  platform_ops: {
    saas_platform: ["read", "write", "manage"],
  },
  partner_admin: {
    saas_platform: ["read"],
    office_settings: ["read", "write", "manage"],
    team_management: ["read", "write", "manage"],
    intake_inbox: ["read", "write"],
    clients: ["read", "write", "export"],
    conflicts: ["read", "write", "approve"],
    matters: ["read", "write", "approve", "manage"],
    matter_strategy: ["read", "write"],
    cases: ["read", "write"],
    communications: ["read", "write", "validate"],
    deadlines: ["read", "write", "validate", "approve"],
    agenda: ["read", "write"],
    documents: ["read", "write", "approve", "publish"],
    contracts: ["read", "write", "approve"],
    finance: ["read", "write", "approve", "reverse", "export"],
    portal_admin: ["read", "write", "publish", "manage"],
    reports: ["read", "export"],
    audit: ["read", "export"],
    lgpd_dsar: ["read", "write", "approve"],
    ai_assist: ["read", "write"],
  },
  coordinator: {
    office_settings: ["read"],
    team_management: ["read"],
    intake_inbox: ["read", "write"],
    clients: ["read", "write"],
    conflicts: ["read", "write", "approve"],
    matters: ["read", "write", "approve"],
    matter_strategy: ["read", "write"],
    cases: ["read", "write"],
    communications: ["read", "write", "validate"],
    deadlines: ["read", "write", "validate", "approve"],
    agenda: ["read", "write"],
    documents: ["read", "write", "approve", "publish"],
    contracts: ["read", "write"],
    finance: ["read"],
    portal_admin: ["read", "write", "publish"],
    reports: ["read", "export"],
    audit: ["read"],
    lgpd_dsar: ["read"],
    ai_assist: ["read", "write"],
  },
  lawyer: {
    office_settings: ["read"],
    intake_inbox: ["read", "write"],
    clients: ["read", "write"],
    conflicts: ["read", "write"],
    matters: ["read", "write"],
    matter_strategy: ["read", "write"],
    cases: ["read", "write"],
    communications: ["read", "write", "validate"],
    deadlines: ["read", "write", "validate"],
    agenda: ["read", "write"],
    documents: ["read", "write", "approve", "publish"],
    contracts: ["read", "write"],
    finance: ["read"],
    portal_admin: ["read", "write", "publish"],
    reports: ["read"],
    audit: ["read"],
    ai_assist: ["read", "write"],
  },
  assistant: {
    intake_inbox: ["read", "write"],
    clients: ["read", "write"],
    conflicts: ["read", "write"],
    matters: ["read", "write"],
    cases: ["read"],
    communications: ["read", "write"],
    deadlines: ["read", "write"],
    agenda: ["read", "write"],
    documents: ["read", "write"],
    contracts: ["read"],
    ai_assist: ["read", "write"],
  },
  reception: {
    intake_inbox: ["read", "write"],
    clients: ["read", "write"],
    conflicts: ["read", "write"],
    matters: ["read"],
    agenda: ["read", "write"],
    contracts: ["read"],
  },
  finance: {
    clients: ["read"],
    matters: ["read"],
    contracts: ["read"],
    finance: ["read", "write", "reverse", "export"],
    portal_admin: ["read", "publish"],
    reports: ["read", "export"],
    audit: ["read"],
  },
  client: {
    portal_client: ["read", "write"],
  },
  auditor: {
    office_settings: ["read"],
    team_management: ["read"],
    intake_inbox: ["read"],
    clients: ["read"],
    conflicts: ["read"],
    matters: ["read"],
    cases: ["read"],
    communications: ["read"],
    deadlines: ["read"],
    agenda: ["read"],
    documents: ["read"],
    contracts: ["read"],
    finance: ["read", "export"],
    reports: ["read", "export"],
    audit: ["read", "export"],
    lgpd_dsar: ["read"],
  },
};

export function mapAccountRoleToLegalRole(
  accountRole: AccountRole | null | undefined,
  explicitLegalRole?: LegalRole | null,
): LegalRole {
  if (explicitLegalRole) return explicitLegalRole;
  switch (accountRole) {
    case "owner":
    case "admin":
      return "partner_admin";
    case "agent":
      return "lawyer";
    case "viewer":
      return "auditor";
    default:
      return "assistant";
  }
}

export function canPerform(
  user: Pick<LegalUserContext, "legalRole">,
  resource: LegalResource,
  action: LegalAction,
): boolean {
  const allowed = ROLE_MATRIX[user.legalRole]?.[resource];
  return Array.isArray(allowed) && allowed.includes(action);
}

export function isBreakGlassActive(
  grant: BreakGlassGrant,
  userId: string,
  accountId: string,
  matterId?: string,
  now: Date = new Date(),
): boolean {
  if (grant.operator_user_id !== userId) return false;
  if (grant.account_id !== accountId) return false;
  if (grant.revoked_at) return false;
  if (!grant.reason || grant.reason.trim().length < 10) return false;
  const starts = new Date(grant.starts_at).getTime();
  const ends = new Date(grant.expires_at).getTime();
  const t = now.getTime();
  if (t < starts || t > ends) return false;
  if (matterId && grant.matter_id && grant.matter_id !== matterId) return false;
  return true;
}

export interface MatterAccessDecision {
  allowed: boolean;
  reason: string;
  minimalReferenceOnly?: boolean;
  canViewStrategy?: boolean;
}

/**
 * Avalia acesso a uma pasta jurídica aplicando:
 * - Isolamento multi-tenant (`account_id`)
 * - Bloqueio padrão para `platform_ops` sem break-glass ativo
 * - Precedência absoluta da barreira de sigilo (`matter.is_restricted`)
 *   inclusive contra `partner_admin` sem grant explícito ativo
 * - Referência mínima para `finance` e `reception`
 */
export function evaluateMatterAccess(
  user: LegalUserContext,
  matter: Matter,
  breakGlassGrants: BreakGlassGrant[] = [],
  now: Date = new Date(),
): MatterAccessDecision {
  // 1. Break-glass excepcional para operação SaaS
  if (user.legalRole === "platform_ops") {
    const activeGrant = breakGlassGrants.find((g) =>
      isBreakGlassActive(g, user.userId, matter.account_id, matter.id, now),
    );
    if (activeGrant) {
      return {
        allowed: true,
        reason: `Acesso excepcional autorizado (break-glass: ${activeGrant.id})`,
        canViewStrategy: false,
      };
    }
    return {
      allowed: false,
      reason: "Operação SaaS não possui acesso rotineiro às pastas jurídicas",
    };
  }

  // 2. Isolamento de escritório (tenant)
  if (user.accountId !== matter.account_id) {
    return {
      allowed: false,
      reason: "Isolamento multi-tenant: pasta pertence a outro escritório",
    };
  }

  // 3. Cliente acessa somente pelo Portal do Cliente (nunca via rota interna de pasta)
  if (user.legalRole === "client") {
    return {
      allowed: false,
      reason: "Cliente deve acessar apenas itens publicados no Portal do Cliente",
    };
  }

  const nowMs = now.getTime();
  const hasExplicitGrant = matter.access_grants.some(
    (g) =>
      g.user_id === user.userId &&
      !g.revoked_at &&
      (!g.expires_at || new Date(g.expires_at).getTime() > nowMs),
  );
  const activeMember = matter.members.find(
    (m) =>
      m.user_id === user.userId &&
      m.is_active &&
      !m.revoked_at &&
      (!m.access_expires_at || new Date(m.access_expires_at).getTime() > nowMs),
  );

  // 4. PRECEDÊNCIA ABSOLUTA DA BARREIRA DE SIGILO (Ethical Wall)
  // Mesmo partner_admin sem grant explícito ou vínculo ativo é BLOQUEADO.
  if (matter.is_restricted) {
    if (hasExplicitGrant || activeMember) {
      return {
        allowed: true,
        reason: "Grant explícito ou vínculo ativo em pasta restrita",
        canViewStrategy: Boolean(
          hasExplicitGrant ||
            (activeMember?.can_view_strategy && user.legalRole !== "assistant"),
        ),
      };
    }
    return {
      allowed: false,
      reason:
        "Pasta sob sigilo/acesso restrito: exige concessão explícita na lista de acesso (barreira de sigilo)",
    };
  }

  // 5. Perfis com referência mínima (financeiro e recepção)
  if (user.legalRole === "finance" || user.legalRole === "reception") {
    return {
      allowed: true,
      reason: "Referência mínima autorizada para perfil operacional",
      minimalReferenceOnly: true,
      canViewStrategy: false,
    };
  }

  // 6. Sócio, Coordenador e Auditor em pastas não restritas
  if (
    user.legalRole === "partner_admin" ||
    user.legalRole === "coordinator" ||
    user.legalRole === "auditor"
  ) {
    return {
      allowed: true,
      reason: "Acesso permitido por perfil em pasta não restrita",
      canViewStrategy: user.legalRole !== "auditor",
    };
  }

  // 7. Advogado e Assistente: membro, responsável ou mesma equipe
  const inSameTeam =
    !matter.team_id || user.teamIds.includes(matter.team_id);
  if (
    activeMember ||
    matter.lead_lawyer_user_id === user.userId ||
    inSameTeam
  ) {
    return {
      allowed: true,
      reason: "Acesso autorizado por vinculação à pasta ou equipe",
      canViewStrategy:
        user.legalRole === "lawyer" &&
        Boolean(activeMember?.can_view_strategy ?? true),
    };
  }

  return {
    allowed: false,
    reason: "Usuário sem vínculo com a pasta ou equipe responsável",
  };
}

/**
 * Remove estratégia restrita e dados excessivos conforme decisão de acesso.
 */
export function sanitizeMatterForUser(
  matter: Matter,
  decision: MatterAccessDecision,
): Matter {
  if (decision.minimalReferenceOnly) {
    return {
      ...matter,
      object_description: null,
      restricted_strategy: null,
      next_step: null,
      checklists: [],
      access_grants: [],
      parties: matter.parties.filter((p) => p.party_role === "cliente"),
    };
  }
  if (!decision.canViewStrategy) {
    return {
      ...matter,
      restricted_strategy: null,
    };
  }
  return matter;
}

/**
 * Redação de dados sensíveis para logs e telemetria (LGPD / Sigilo).
 * Nunca registrar CPF, CNPJ, tokens, chaves API ou telefones crus.
 */
export function redactSensitiveForLog(input: string): string {
  return input
    // CPF (000.000.000-00 ou 11 dígitos)
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF_REDACTED]")
    // CNPJ (00.000.000/0000-00 ou 14 dígitos)
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[CNPJ_REDACTED]")
    // APIKey / Bearer tokens
    .replace(/(Bearer|APIKey)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [TOKEN_REDACTED]")
    // Chaves wacrm_ / sk-
    .replace(/\b(wacrm_live_|sk-)[A-Za-z0-9_-]{8,}\b/g, "[KEY_REDACTED]");
}

export function maskDocument(doc: string | null | undefined): string {
  if (!doc) return "—";
  const digits = doc.replace(/\D/g, "");
  if (digits.length === 11) {
    return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  }
  if (digits.length === 14) {
    return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  }
  return "***";
}
