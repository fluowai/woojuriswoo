"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, CheckSquare, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatBrl,
  formatDateBr,
  legalFetch,
  useDemoPersona,
} from "@/components/legal/legal-client";
import {
  LegalErrorState,
  LegalLoadingState,
  LegalPageHeader,
  StatusPill,
} from "@/components/legal/legal-ui";
import type {
  AuditEvent,
  CourtCase,
  LegalContract,
  LegalDeadline,
  LegalDocument,
  LegalHearing,
  Matter,
  ProtocolReceipt,
  Receivable,
} from "@/lib/legal/types";

interface MatterDetailResponse {
  matter: Matter;
  accessDecision: {
    allowed: boolean;
    reason: string;
    minimalReferenceOnly?: boolean;
    canViewStrategy?: boolean;
  };
  tabs: {
    cases: CourtCase[];
    deadlines: LegalDeadline[];
    hearings: LegalHearing[];
    documents: LegalDocument[];
    contracts: LegalContract[];
    receivables: Receivable[];
    protocols: ProtocolReceipt[];
    audit: AuditEvent[];
  };
}

export default function MatterDetailPage() {
  const params = useParams<{ id: string }>();
  const { userId } = useDemoPersona();
  const [data, setData] = useState<MatterDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<MatterDetailResponse>(
      `/api/legal/matters/${params.id}`,
    );
    if (!res.ok || !res.data) {
      setError({ message: res.error ?? "Erro ao carregar pasta", status: res.status });
    } else {
      setData(res.data);
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const toggleChecklistItem = async (checklistId: string, itemId: string) => {
    const res = await legalFetch(`/api/legal/matters/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        action: "toggle_checklist",
        checklistId,
        itemId,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    load();
  };

  const handleCloseMatter = async () => {
    const res = await legalFetch(`/api/legal/matters/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "close_matter" }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Pasta encerrada com checklist validado e auditoria.");
    load();
  };

  if (loading) return <LegalLoadingState />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/matters">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Voltar para Pastas
          </Button>
        </Link>
        <LegalErrorState
          message={error?.message ?? "Pasta indisponível."}
          status={error?.status}
          onRetry={load}
        />
      </div>
    );
  }

  const { matter, tabs, accessDecision } = data;

  return (
    <div className="space-y-4">
      <Link href="/matters">
        <Button variant="ghost" size="sm" className="-ml-2">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Voltar para Pastas Jurídicas
        </Button>
      </Link>

      <LegalPageHeader
        title={`${matter.code} — ${matter.title}`}
        description={
          accessDecision.minimalReferenceOnly
            ? "Exibição de referência mínima conforme perfil de acesso (estratégia e autos ocultos)."
            : matter.object_description || "Pasta jurídica ativa."
        }
        badge={matter.is_restricted ? "SIGILO RESTRITO" : matter.matter_type}
        actions={
          !accessDecision.minimalReferenceOnly && matter.status !== "encerrado" ? (
            <Button size="sm" variant="outline" onClick={handleCloseMatter}>
              <ShieldCheck className="mr-1.5 h-4 w-4" />
              Validar Encerramento
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="team">Equipe ({matter.members.length})</TabsTrigger>
          <TabsTrigger value="parties">Partes ({matter.parties.length})</TabsTrigger>
          <TabsTrigger value="cases">Processos ({tabs.cases.length})</TabsTrigger>
          <TabsTrigger value="deadlines">Prazos ({tabs.deadlines.length})</TabsTrigger>
          <TabsTrigger value="agenda">Agenda ({tabs.hearings.length})</TabsTrigger>
          <TabsTrigger value="documents">Documentos ({tabs.documents.length})</TabsTrigger>
          <TabsTrigger value="contracts">Contratos ({tabs.contracts.length})</TabsTrigger>
          <TabsTrigger value="finance">Financeiro ({tabs.receivables.length})</TabsTrigger>
          <TabsTrigger value="audit">Auditoria ({tabs.audit.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Dados Centrais &amp; Próximo Passo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p><strong>Status:</strong> {matter.status}</p>
                <p><strong>Área:</strong> {matter.practice_area} · <strong>Tipo:</strong> {matter.matter_type}</p>
                <p><strong>Valor da causa:</strong> {matter.claim_value_cents ? formatBrl(matter.claim_value_cents) : "Sem valor / Consultivo"}</p>
                <p><strong>Próximo passo:</strong> {matter.next_step || "—"}</p>
                <p><strong>Política de guarda:</strong> {matter.retention_policy_years} anos</p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Lock className="h-4 w-4 text-primary" />
                  Estratégia Jurídica (Acesso Restrito)
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-foreground/85">
                {matter.restricted_strategy ?? "Oculta para o perfil atual ou ainda não registrada."}
              </CardContent>
            </Card>
          </div>

          {matter.checklists.map((chk) => (
            <Card key={chk.id} className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CheckSquare className="h-4 w-4 text-primary" />
                  {chk.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {chk.items.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleChecklistItem(chk.id, item.id)}
                    />
                    <span className={item.done ? "line-through text-muted-foreground" : "text-foreground"}>
                      {item.label}
                    </span>
                    {item.required ? (
                      <StatusPill label="Obrigatório" tone="warning" />
                    ) : null}
                  </label>
                ))}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="team" className="space-y-2">
          {matter.members.map((m) => (
            <Card key={m.user_id} className="border-border bg-card">
              <CardContent className="flex items-center justify-between py-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground">{m.full_name}</p>
                  <p className="text-muted-foreground">Papel: {m.member_role}</p>
                </div>
                <StatusPill label={m.is_active ? "Ativo" : "Revogado"} tone={m.is_active ? "success" : "danger"} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="parties" className="space-y-2">
          {matter.parties.map((p) => (
            <Card key={p.id} className="border-border bg-card">
              <CardContent className="flex items-center justify-between py-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground">{p.entity_name}</p>
                  <p className="text-muted-foreground">
                    Papel: {p.party_role} · Tipo: {p.person_type} · Procuração: {p.poa_registered ? "Registrada" : "Pendente"}
                  </p>
                </div>
                <StatusPill label={p.party_role} tone="primary" />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="cases" className="space-y-2">
          {tabs.cases.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum processo judicial vinculado (pasta extrajudicial/consultiva funciona sem CNJ).</p>
          ) : (
            tabs.cases.map((c) => (
              <Card key={c.id} className="border-border bg-card">
                <CardContent className="space-y-1 py-3 text-xs">
                  <p className="font-semibold text-foreground">{c.cnj_number || c.legacy_number}</p>
                  <p className="text-muted-foreground">{c.tribunal_code} · {c.degree} · {c.court_organ} · {c.case_class}</p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="deadlines" className="space-y-2">
          {tabs.deadlines.map((d) => (
            <Card key={d.id} className="border-border bg-card">
              <CardContent className="flex items-center justify-between py-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground">{d.title}</p>
                  <p className="text-muted-foreground">
                    Interno: {formatDateBr(d.internal_due_date)} · Legal: {formatDateBr(d.legal_due_date)} · Regime: {d.procedural_regime}
                  </p>
                </div>
                <StatusPill label={d.status} tone={d.status === "confirmado" ? "success" : "warning"} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="agenda" className="space-y-2">
          {tabs.hearings.map((h) => (
            <Card key={h.id} className="border-border bg-card">
              <CardContent className="flex items-center justify-between py-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground">{h.title}</p>
                  <p className="text-muted-foreground">{formatDateBr(h.starts_at)} · {h.modality} · {h.location_or_link}</p>
                </div>
                <StatusPill label={h.status} tone="primary" />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="documents" className="space-y-2">
          {tabs.documents.map((d) => (
            <Card key={d.id} className="border-border bg-card">
              <CardContent className="flex items-center justify-between py-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground">{d.title}</p>
                  <p className="text-muted-foreground">
                    Categoria: {d.category} · Versões: {d.versions.length} · Portal: {d.portal_published ? "Publicado" : "Interno"}
                  </p>
                </div>
                <StatusPill
                  label={d.quarantine_status}
                  tone={d.quarantine_status === "aprovado" ? "success" : "warning"}
                />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="contracts" className="space-y-2">
          {tabs.contracts.map((c) => (
            <Card key={c.id} className="border-border bg-card">
              <CardContent className="flex items-center justify-between py-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground">{c.contract_number} — {c.title}</p>
                  <p className="text-muted-foreground">Valor: {formatBrl(c.total_value_cents)} · {c.installments_count}x · Método: {c.signature_method}</p>
                </div>
                <StatusPill label={c.status} tone={c.status === "assinado" ? "success" : "primary"} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="finance" className="space-y-2">
          {tabs.receivables.map((r) => (
            <Card key={r.id} className="border-border bg-card">
              <CardContent className="flex items-center justify-between py-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground">{r.description}</p>
                  <p className="text-muted-foreground">
                    Total: {formatBrl(r.total_cents)} · Pago: {formatBrl(r.paid_cents)} · Classe: {r.revenue_class}
                  </p>
                </div>
                <StatusPill label={r.status} tone={r.status === "pago" ? "success" : "warning"} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="audit" className="space-y-2">
          {tabs.audit.map((a) => (
            <Card key={a.id} className="border-border bg-card">
              <CardContent className="flex items-center justify-between py-2.5 text-xs">
                <div>
                  <p className="font-medium text-foreground">{a.operation}</p>
                  <p className="text-muted-foreground">Ator: {a.actor_role} · {a.created_at}</p>
                </div>
                <StatusPill label={a.outcome} tone={a.outcome === "allowed" ? "success" : "danger"} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
