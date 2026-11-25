"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, PlugZap, ShieldCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { legalFetch, useDemoPersona } from "@/components/legal/legal-client";
import {
  LegalErrorState,
  LegalLoadingState,
  LegalPageHeader,
  StatusPill,
} from "@/components/legal/legal-ui";
import {
  LEGAL_ROLE_LABELS,
  type IntegrationStatus,
  type LegalTeam,
  type LegalUserContext,
  type OfficeUnit,
} from "@/lib/legal/types";
import type { OfficeGovernanceConfig } from "@/lib/legal/store";

export default function TeamAndGovernancePage() {
  const { userId } = useDemoPersona();
  const [units, setUnits] = useState<OfficeUnit[]>([]);
  const [teams, setTeams] = useState<LegalTeam[]>([]);
  const [members, setMembers] = useState<LegalUserContext[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [governance, setGovernance] = useState<OfficeGovernanceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [repRes, healthRes] = await Promise.all([
      legalFetch<{
        units: OfficeUnit[];
        teams: LegalTeam[];
        members: LegalUserContext[];
        integrations: IntegrationStatus[];
      }>("/api/legal/reports"),
      legalFetch<{ governance: OfficeGovernanceConfig | null }>("/api/legal/health"),
    ]);
    if (!repRes.ok && !healthRes.ok) {
      setError({ message: repRes.error ?? "Erro ao carregar equipe", status: repRes.status });
    } else {
      setUnits(repRes.data?.units ?? []);
      setTeams(repRes.data?.teams ?? []);
      setMembers(repRes.data?.members ?? []);
      setIntegrations(repRes.data?.integrations ?? []);
      setGovernance(healthRes.data?.governance ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const toggleGovFlag = async (
    key:
      | "broadcasts_enabled"
      | "ai_autonomous_disabled"
      | "mcp_enabled"
      | "conflict_block_hiring",
  ) => {
    if (!governance) return;
    const res = await legalFetch<{ governance: OfficeGovernanceConfig }>("/api/legal/health", {
      method: "PATCH",
      body: JSON.stringify({ [key]: !governance[key] }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setGovernance(res.data?.governance ?? null);
    toast.success("Política de governança atualizada e auditada.");
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Equipe, Unidades & Governança OAB / SaaS"
        description="Estrutura multi-unidade, 9 perfis jurídicos com MFA, compliance Provimento OAB 205/2021 e status transparente das integrações (produção / homologação / indisponível)."
        badge="Governança"
      />

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : (
        <>
          {governance ? (
            <Card className="border-primary/30 bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Controles de Compliance Jurídico — {governance.legal_name} ({governance.oab_society_number})
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-xs sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="font-semibold">Campanhas / Prospecção Automática (OAB 205/2021)</p>
                    <p className="text-muted-foreground">Desabilitada por padrão no ambiente jurídico</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleGovFlag("broadcasts_enabled")}
                  >
                    {governance.broadcasts_enabled ? "Habilitado" : "Desabilitado"}
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="font-semibold">Bloqueio de Bots Autônomos de IA</p>
                    <p className="text-muted-foreground">Exige revisão humana em peças, prazos e mensagens</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleGovFlag("ai_autonomous_disabled")}
                  >
                    {governance.ai_autonomous_disabled ? "Bloqueado (Seguro)" : "Liberado"}
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="font-semibold">Servidor MCP / Chaves API Amplas</p>
                    <p className="text-muted-foreground">Desabilitado por padrão até revisão específica</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleGovFlag("mcp_enabled")}
                  >
                    {governance.mcp_enabled ? "Ativo" : "Desabilitado"}
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="font-semibold">Bloqueio de Contratação por Conflito Pendente</p>
                    <p className="text-muted-foreground">Impede conversão em pasta sem decisão auditada</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleGovFlag("conflict_block_hiring")}
                  >
                    {governance.conflict_block_hiring ? "Obrigatório" : "Flexível"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-primary" />
                  Unidades / Filiais ({units.length}) &amp; Equipes ({teams.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {units.map((u) => (
                  <div key={u.id} className="flex items-center justify-between rounded border border-border px-3 py-2">
                    <div>
                      <p className="font-semibold">{u.name} ({u.code})</p>
                      <p className="text-muted-foreground">Fuso IANA: {u.timezone}</p>
                    </div>
                    <StatusPill label={u.is_headquarters ? "Matriz" : "Filial"} tone="primary" />
                  </div>
                ))}
                {teams.map((tm) => (
                  <div key={tm.id} className="rounded border border-border/70 bg-card-2 px-3 py-2">
                    <p className="font-medium">{tm.name}</p>
                    <p className="text-muted-foreground">
                      Área: {tm.practice_area ?? "Multidisciplinar"} · Membros: {tm.member_user_ids.length}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <UsersRound className="h-4 w-4 text-primary" />
                  Integrantes &amp; Perfis Jurídicos ({members.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {members.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between rounded border border-border px-3 py-2">
                    <div>
                      <p className="font-semibold">{m.fullName}</p>
                      <p className="text-muted-foreground">
                        {m.email} {m.oabNumber ? `· ${m.oabNumber}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusPill label={LEGAL_ROLE_LABELS[m.legalRole]} tone="primary" />
                      <StatusPill label={m.mfaEnrolled ? "MFA OK" : "Sem MFA"} tone={m.mfaEnrolled ? "success" : "warning"} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <PlugZap className="h-4 w-4 text-primary" />
                Matriz de Integrações &amp; Conectores (Transparência Operacional)
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
              {integrations.map((intg) => (
                <div key={intg.provider} className="space-y-1 rounded-lg border border-border bg-card-2 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{intg.label}</span>
                    <StatusPill
                      label={intg.mode}
                      tone={
                        intg.mode === "producao"
                          ? "success"
                          : intg.mode === "homologacao"
                            ? "warning"
                            : "neutral"
                      }
                    />
                  </div>
                  <p className="text-muted-foreground">{intg.note}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
