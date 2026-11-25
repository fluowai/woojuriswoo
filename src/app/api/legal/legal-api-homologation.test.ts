import { beforeEach, describe, expect, it } from "vitest";
import { GET as getMatters } from "./matters/route";
import { GET as getMatterById, PATCH as patchMatterById } from "./matters/[id]/route";
import { PATCH as patchIntake } from "./intakes/route";
import { POST as postConflict, PATCH as patchConflict } from "./conflicts/route";
import { PUT as queryDataJud } from "./cases/route";
import { PATCH as patchContract } from "./contracts/route";
import { GET as getPortal, PATCH as patchPortal } from "./portal/route";
import { PILOT_CNJ_FIXTURES } from "@/lib/legal/datajud";
import { resetLegalStoreForTests } from "@/lib/legal/store";

function makeReq(
  url: string,
  opts: { method?: string; demoUser?: string; body?: unknown } = {},
) {
  const headers = new Headers();
  if (opts.demoUser) headers.set("x-woojuris-demo-user", opts.demoUser);
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  return new Request(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

describe("API Jurídica — Homologação End-to-End com Autorização no Backend", () => {
  beforeEach(() => {
    process.env.WOOJURIS_HOMOLOGATION_MODE = "true";
    resetLegalStoreForTests();
  });

  it("nega HTTP 403 em pasta restrita para Sócio/Admin sem grant e libera para Advogada com grant", async () => {
    // Sócio sem grant tenta ler pasta restrita -> 403
    const deniedRes = await getMatterById(
      makeReq("http://localhost/api/legal/matters/mat-restrita-01", {
        demoUser: "user-socio-1",
      }),
      { params: Promise.resolve({ id: "mat-restrita-01" }) },
    );
    expect(deniedRes.status).toBe(403);

    // Listagem do sócio omite a pasta restrita e informa hiddenRestrictedCount = 1
    const listRes = await getMatters(
      makeReq("http://localhost/api/legal/matters", { demoUser: "user-socio-1" }),
    );
    const listJson = await listRes.json();
    expect(listJson.matters.some((m: { id: string }) => m.id === "mat-restrita-01")).toBe(false);
    expect(listJson.hiddenRestrictedCount).toBe(1);

    // Advogada com grant explícito consegue ler -> 200
    const allowedRes = await getMatterById(
      makeReq("http://localhost/api/legal/matters/mat-restrita-01", {
        demoUser: "user-adv-1",
      }),
      { params: Promise.resolve({ id: "mat-restrita-01" }) },
    );
    expect(allowedRes.status).toBe(200);
  });

  it("bloqueia conversão com conflito pendente, libera após aprovação do Sócio e converte de forma idempotente", async () => {
    // Oportunidade int-002 está com conflito pendente -> bloqueada (409)
    const blockedRes = await patchIntake(
      makeReq("http://localhost/api/legal/intakes", {
        method: "PATCH",
        demoUser: "user-adv-1",
        body: { id: "int-002", action: "convert", idempotency_key: "key-int-002" },
      }),
    );
    expect(blockedRes.status).toBe(409);

    // Assistente/Recepção não pode aprovar decisão de conflito -> 403
    const forbiddenApprove = await patchConflict(
      makeReq("http://localhost/api/legal/conflicts", {
        method: "PATCH",
        demoUser: "user-recep-1",
        body: {
          id: "chk-001",
          decision: "falso_positivo",
          justification: "Tentativa sem alçada",
        },
      }),
    );
    expect(forbiddenApprove.status).toBe(403);

    // Sócio aprova exceção formal
    const approveRes = await patchConflict(
      makeReq("http://localhost/api/legal/conflicts", {
        method: "PATCH",
        demoUser: "user-socio-1",
        body: {
          id: "chk-001",
          decision: "excecao_autorizada",
          justification: "Aprovado pelo comitê com barreira ética dedicada",
        },
      }),
    );
    expect(approveRes.status).toBe(200);

    // Primeira conversão cria pasta
    const conv1 = await patchIntake(
      makeReq("http://localhost/api/legal/intakes", {
        method: "PATCH",
        demoUser: "user-socio-1",
        body: { id: "int-002", action: "convert", idempotency_key: "key-int-002" },
      }),
    );
    expect(conv1.status).toBe(201);
    const j1 = await conv1.json();
    expect(j1.idempotentReplay).toBe(false);

    // Segunda chamada com mesma chave retorna mesma pasta sem duplicar
    const conv2 = await patchIntake(
      makeReq("http://localhost/api/legal/intakes", {
        method: "PATCH",
        demoUser: "user-socio-1",
        body: { id: "int-002", action: "convert", idempotency_key: "key-int-002" },
      }),
    );
    expect(conv2.status).toBe(200);
    const j2 = await conv2.json();
    expect(j2.idempotentReplay).toBe(true);
    expect(j2.matter.id).toBe(j1.matter.id);
  });

  it("executa consulta DataJud em modo homologação (TJSC 2 graus), gera parcelas idempotentes e revoga portal imediatamente", async () => {
    const djRes = await queryDataJud(
      makeReq("http://localhost/api/legal/cases", {
        method: "PUT",
        demoUser: "user-adv-1",
        body: {
          cnj: PILOT_CNJ_FIXTURES.TJSC,
          tribunalCode: "TJSC",
          matterId: "mat-civel-01",
        },
      }),
    );
    expect(djRes.status).toBe(200);
    const djJson = await djRes.json();
    expect(djJson.result.mode).toBe("homologacao");
    expect(djJson.result.hits.length).toBe(2);

    // Contrato ctr-001 já teve parcelas geradas -> idempotente (created: false)
    const finRes = await patchContract(
      makeReq("http://localhost/api/legal/contracts", {
        method: "PATCH",
        demoUser: "user-socio-1",
        body: { id: "ctr-001", action: "generate_receivables" },
      }),
    );
    expect(finRes.status).toBe(200);
    const finJson = await finRes.json();
    expect(finJson.created).toBe(false);

    // Portal ativo funciona, depois revogação bloqueia na hora (403)
    const portalOk = await getPortal(
      makeReq("http://localhost/api/legal/portal?token=woojuris-portal-demo-atlantico-2026"),
    );
    expect(portalOk.status).toBe(200);

    const revoke = await patchPortal(
      makeReq("http://localhost/api/legal/portal", {
        method: "PATCH",
        demoUser: "user-socio-1",
        body: { action: "revoke_invitation", id: "pinv-001" },
      }),
    );
    expect(revoke.status).toBe(200);

    const portalBlocked = await getPortal(
      makeReq("http://localhost/api/legal/portal?token=woojuris-portal-demo-atlantico-2026"),
    );
    expect(portalBlocked.status).toBe(403);
  });

  it("revoga membro da pasta restrita e bloqueia acesso subsequente + registra conflito sob sigilo", async () => {
    // Revoga acesso da advogada na pasta restrita -> próximo acesso dela retorna 403
    const revokeRes = await patchMatterById(
      makeReq("http://localhost/api/legal/matters/mat-restrita-01", {
        method: "PATCH",
        demoUser: "user-adv-1",
        body: { action: "revoke_member", targetUserId: "user-adv-1" },
      }),
      { params: Promise.resolve({ id: "mat-restrita-01" }) },
    );
    expect(revokeRes.status).toBe(200);

    const afterRevoke = await getMatterById(
      makeReq("http://localhost/api/legal/matters/mat-restrita-01", {
        demoUser: "user-adv-1",
      }),
      { params: Promise.resolve({ id: "mat-restrita-01" }) },
    );
    expect(afterRevoke.status).toBe(403);

    // Nova busca de conflito contra parte sob sigilo retorna sinal mínimo
    const confRes = await postConflict(
      makeReq("http://localhost/api/legal/conflicts", {
        method: "POST",
        demoUser: "user-recep-1",
        body: { queryName: "Roberto Alencar Silva", queryDocument: "32165498700" },
      }),
    );
    expect(confRes.status).toBe(201);
    const confJson = await confRes.json();
    expect(confJson.conflictCheck.candidates[0].is_under_secrecy).toBe(true);
  });
});
