"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Coins, FileSignature, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatBrl,
  legalFetch,
  useDemoPersona,
} from "@/components/legal/legal-client";
import {
  LegalEmptyState,
  LegalErrorState,
  LegalLoadingState,
  LegalPageHeader,
  StatusPill,
} from "@/components/legal/legal-ui";
import type { ContractStatus, LegalContract } from "@/lib/legal/types";

export default function ContractsPage() {
  const { userId } = useDemoPersona();
  const [contracts, setContracts] = useState<LegalContract[]>([]);
  const [providerMode, setProviderMode] = useState("homologacao");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [valueReais, setValueReais] = useState("9000");
  const [installments, setInstallments] = useState("3");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<{
      contracts: LegalContract[];
      signatureProviderMode: string;
    }>("/api/legal/contracts");
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar contratos", status: res.status });
    } else {
      setContracts(res.data?.contracts ?? []);
      setProviderMode(res.data?.signatureProviderMode ?? "homologacao");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = Math.round((Number(valueReais.replace(",", ".")) || 0) * 100);
    const res = await legalFetch("/api/legal/contracts", {
      method: "POST",
      body: JSON.stringify({
        matter_id: "mat-consultoria-01",
        title,
        scope_description: scope,
        fee_model: "parcelado",
        total_value_cents: cents,
        installments_count: Number(installments) || 1,
        signature_method: "manual_comprovado",
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Contrato criado em rascunho.");
    setTitle("");
    setScope("");
    setShowCreate(false);
    load();
  };

  const handleTransition = async (id: string, nextStatus: ContractStatus) => {
    const res = await legalFetch("/api/legal/contracts", {
      method: "PATCH",
      body: JSON.stringify({
        id,
        action: "transition",
        nextStatus,
        manualEvidenceNote:
          nextStatus === "assinado"
            ? "Formalização manual comprovada: contrato rubricado e arquivado com hash."
            : undefined,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Contrato atualizado para "${nextStatus}".`);
    load();
  };

  const handleGenerateReceivables = async (id: string) => {
    const res = await legalFetch<{ created: boolean; receivable: { id: string } }>(
      "/api/legal/contracts",
      {
        method: "PATCH",
        body: JSON.stringify({ id, action: "generate_receivables" }),
      },
    );
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      res.data?.created
        ? "Títulos e parcelas gerados no Financeiro!"
        : "Idempotência garantida: títulos já haviam sido gerados anteriormente (sem duplicação).",
    );
    load();
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Contratos & Assinaturas"
        description="Ciclo rascunho → revisão → aprovado → enviado → assinado/recusado/expirado. Adaptador Documenso + formalização manual comprovada e geração idempotente de parcelas."
        badge={`Assinatura: ${providerMode}`}
        actions={
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Novo Contrato
          </Button>
        }
      />

      {showCreate ? (
        <Card className="border-primary/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Novo Contrato de Honorários / Aditivo</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <Label>Título</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div>
                <Label>Valor Total (R$)</Label>
                <Input value={valueReais} onChange={(e) => setValueReais(e.target.value)} required />
              </div>
              <div>
                <Label>Parcelas</Label>
                <Input type="number" min={1} value={installments} onChange={(e) => setInstallments(e.target.value)} required />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Label>Escopo da Contratação</Label>
                <Input value={scope} onChange={(e) => setScope(e.target.value)} required />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit" size="sm">Criar Rascunho</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : contracts.length === 0 ? (
        <LegalEmptyState
          title="Nenhum contrato registrado"
          description="Crie um contrato de honorários para iniciar o fluxo de aprovação e assinatura."
        />
      ) : (
        <div className="space-y-3">
          {contracts.map((c) => (
            <Card key={c.id} className="border-border bg-card">
              <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileSignature className="h-4 w-4 text-primary" />
                    <span className="font-mono text-xs text-primary">{c.contract_number}</span>
                    <span className="font-semibold text-foreground">{c.title}</span>
                    <StatusPill
                      label={c.status}
                      tone={c.status === "assinado" ? "success" : "primary"}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Valor: <strong>{formatBrl(c.total_value_cents)}</strong> ({c.installments_count}x · {c.fee_model}) · Método: {c.signature_method}
                    {c.success_fee_percent ? ` · Êxito: ${c.success_fee_percent}%` : ""}
                  </p>
                  <p className="text-xs text-foreground/80">{c.scope_description}</p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {c.status === "rascunho" ? (
                    <Button size="sm" variant="outline" onClick={() => handleTransition(c.id, "revisao")}>
                      Enviar p/ Revisão
                    </Button>
                  ) : null}
                  {c.status === "revisao" ? (
                    <Button size="sm" variant="outline" onClick={() => handleTransition(c.id, "aprovado")}>
                      Aprovar Contrato
                    </Button>
                  ) : null}
                  {c.status === "aprovado" || c.status === "enviado" ? (
                    <Button size="sm" onClick={() => handleTransition(c.id, "assinado")}>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      Registrar Assinatura Manual
                    </Button>
                  ) : null}
                  {c.status === "assinado" ? (
                    <Button size="sm" variant="outline" onClick={() => handleGenerateReceivables(c.id)}>
                      <Coins className="mr-1 h-3.5 w-3.5 text-primary" />
                      {c.receivables_generated ? "Revalidar Títulos (Idempotente)" : "Gerar Parcelas no Financeiro"}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
