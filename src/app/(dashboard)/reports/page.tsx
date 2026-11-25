"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BarChart3, Bot, Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
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
import type { AuditEvent, DataSubjectRequest } from "@/lib/legal/types";

interface ReportsPayload {
  kpiReport: {
    generatedAt: string;
    timezone: string;
    periodLabel: string;
    indicators: Array<{
      key: string;
      label: string;
      value: string;
      formula: string;
    }>;
  };
  dsarRequests: DataSubjectRequest[];
  auditEvents: AuditEvent[];
}

export default function ReportsPage() {
  const { userId } = useDemoPersona();
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const [aiInput, setAiInput] = useState(
    "Cliente relata cobrança de juros acima da média de mercado em CCB assinada em 2024 e encaminhou contrato e extratos.",
  );
  const [aiOutput, setAiOutput] = useState<{
    summary: string;
    citations: Array<{ label: string; pageOrRef: string }>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<ReportsPayload>("/api/legal/reports");
    if (!res.ok || !res.data) {
      setError({ message: res.error ?? "Erro ao carregar relatórios", status: res.status });
    } else {
      setData(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handleRunAssistiveAi = async () => {
    const res = await legalFetch<{
      suggestion: {
        summary: string;
        citations: Array<{ label: string; pageOrRef: string }>;
      };
    }>("/api/legal/reports", {
      method: "POST",
      body: JSON.stringify({
        matterId: "mat-civel-01",
        taskKind: "classificar_mensagem",
        inputText: aiInput,
        citations: [
          {
            sourceType: "document",
            sourceId: "doc-001",
            label: "Procuração Ad Judicia — v1",
            version: 1,
            pageOrRef: "p. 1",
          },
        ],
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setAiOutput(res.data?.suggestion ?? null);
    toast.success("Sugestão assistiva gerada com citações (revisão humana obrigatória).");
  };

  const handleExportCsv = () => {
    if (!data) return;
    const rows = [
      "indicador;valor;formula;fuso",
      ...data.kpiReport.indicators.map(
        (i) => `"${i.label}";"${i.value}";"${i.formula}";"${data.kpiReport.timezone}"`,
      ),
    ].join("\n");
    const blob = new Blob([rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `woojuris-relatorio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Relatório exportado com controle de colunas.");
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Relatórios Gerenciais, IA Assistiva & LGPD"
        description="Indicadores com fórmula, período e fuso explícitos; IA assistiva com citações obrigatórias e revisão humana; pedidos de titulares (DSAR) e trilha de auditoria imutável."
        badge="Fase 5"
        actions={
          <Button size="sm" variant="outline" onClick={handleExportCsv}>
            <Download className="mr-1.5 h-4 w-4" />
            Exportar Indicadores CSV
          </Button>
        }
      />

      {loading ? (
        <LegalLoadingState />
      ) : error || !data ? (
        <LegalErrorState
          message={error?.message ?? "Relatórios indisponíveis"}
          status={error?.status}
          onRetry={load}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.kpiReport.indicators.map((ind) => (
              <Card key={ind.key} className="border-border bg-card">
                <CardHeader className="pb-1">
                  <CardTitle className="flex items-center justify-between text-xs text-muted-foreground">
                    {ind.label}
                    <BarChart3 className="h-4 w-4 text-primary" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-foreground">{ind.value}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Fórmula: {ind.formula}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-primary/30 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Bot className="h-4 w-4 text-primary" />
                IA Assistiva Jurídica (Citações Obrigatórias · Bots Autônomos Desabilitados por Padrão)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={2} value={aiInput} onChange={(e) => setAiInput(e.target.value)} />
              <Button size="sm" onClick={handleRunAssistiveAi}>
                Gerar Sugestão Assistiva com Citações
              </Button>
              {aiOutput ? (
                <div className="space-y-1.5 rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs">
                  <p className="font-medium text-foreground">{aiOutput.summary}</p>
                  <p className="text-muted-foreground">
                    Citações verificadas:{" "}
                    {aiOutput.citations.map((c) => `${c.label} (${c.pageOrRef})`).join("; ")}
                  </p>
                  <StatusPill label="Revisão humana obrigatória · Telemetria sem PII" tone="warning" />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  LGPD — Pedidos de Titulares (DSAR)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {data.dsarRequests.map((d) => (
                  <div key={d.id} className="rounded-lg border border-border bg-card-2 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{d.requester_name} ({d.requester_document_masked})</span>
                      <StatusPill label={d.status} tone="warning" />
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      Tipo: {d.request_type} · Prazo legal: {formatDateBr(d.due_date)} · Identidade verificada: {d.identity_verified ? "Sim" : "Não"}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Trilha de Auditoria Recente (Append-Only)</CardTitle>
              </CardHeader>
              <CardContent className="max-h-72 space-y-1.5 overflow-y-auto text-xs">
                {data.auditEvents.slice(0, 15).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded border border-border px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{a.operation}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {a.actor_role} · {a.resource_type} {a.reason ? `· ${a.reason}` : ""}
                      </p>
                    </div>
                    <StatusPill label={a.outcome} tone={a.outcome === "allowed" ? "success" : "danger"} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
