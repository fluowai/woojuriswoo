"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Inbox, Plus, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatDateBr,
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
import type { LegalCommunication } from "@/lib/legal/types";

export default function CommunicationsPage() {
  const { userId } = useDemoPersona();
  const [items, setItems] = useState<LegalCommunication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const [kind, setKind] = useState<LegalCommunication["communication_kind"]>("publicacao");
  const [source, setSource] = useState<LegalCommunication["source_name"]>("manual");
  const [summary, setSummary] = useState("");
  const [pubDate, setPubDate] = useState("2026-11-22");
  const [extId, setExtId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    const res = await legalFetch<{ communications: LegalCommunication[] }>(
      `/api/legal/communications?${params.toString()}`,
    );
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar comunicações", status: res.status });
    } else {
      setItems(res.data?.communications ?? []);
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await legalFetch<{ duplicateDetected: boolean }>(
      "/api/legal/communications",
      {
        method: "POST",
        body: JSON.stringify({
          communication_kind: kind,
          source_name: source,
          summary,
          publication_date: pubDate,
          external_identifier: extId || undefined,
          matter_id: "mat-civel-01",
        }),
      },
    );
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      res.data?.duplicateDetected
        ? "Publicação duplicada detectada e deduplicada automaticamente."
        : "Comunicação oficial registrada na fila 'nova'.",
    );
    setSummary("");
    setExtId("");
    setShowCreate(false);
    load();
  };

  const handleTransition = async (
    id: string,
    queue_status: LegalCommunication["queue_status"],
  ) => {
    const justification =
      queue_status === "descartada"
        ? "Comunicação sem efeito de prazo / duplicada após conferência manual"
        : undefined;
    const res = await legalFetch("/api/legal/communications", {
      method: "PATCH",
      body: JSON.stringify({ id, queue_status, justification }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Item movido para "${queue_status}".`);
    load();
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Central de Comunicações Oficiais"
        description="Separação rigorosa entre movimentação, publicação, intimação/citação, data de ciência e evento interno. Fila: nova → classificada → em revisão → vinculada/descartada."
        badge="Fase 2"
        actions={
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Registrar Comunicação Manual
          </Button>
        }
      />

      <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-foreground">
        <ShieldAlert className="h-4 w-4 shrink-0 text-primary" />
        <span>
          <strong>Proteção CNJ (Res. 569/2024):</strong> conectores DJEN / Domicílio Judicial Eletrônico / eproc / PJe / e-SAJ permanecem em <strong>modo homologação manual</strong> com captura automática de ciência <strong>bloqueada por padrão</strong>.
        </span>
      </div>

      {showCreate ? (
        <Card className="border-primary/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Entrada Manual / Upload de Recorte Oficial</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleIngest} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label>Natureza</Label>
                <select
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as LegalCommunication["communication_kind"])
                  }
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="publicacao">Publicação (DJE / DJEN)</option>
                  <option value="intimacao">Intimação</option>
                  <option value="citacao">Citação</option>
                  <option value="ciencia">Data de Ciência</option>
                  <option value="movimentacao">Movimentação</option>
                  <option value="evento_interno">Evento Interno</option>
                </select>
              </div>
              <div>
                <Label>Fonte</Label>
                <select
                  value={source}
                  onChange={(e) =>
                    setSource(e.target.value as LegalCommunication["source_name"])
                  }
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="manual">Manual / Conferência Portal</option>
                  <option value="djen">DJEN (Homologação)</option>
                  <option value="dje">DJE Estadual</option>
                  <option value="eproc">eproc</option>
                  <option value="pje">PJe</option>
                  <option value="esaj">e-SAJ</option>
                  <option value="upload_arquivo">Upload de Arquivo</option>
                </select>
              </div>
              <div>
                <Label>Data de Publicação / Ciência</Label>
                <Input type="date" value={pubDate} onChange={(e) => setPubDate(e.target.value)} />
              </div>
              <div>
                <Label>Identificador Oficial</Label>
                <Input value={extId} onChange={(e) => setExtId(e.target.value)} placeholder="DJEN-2026-..." />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Label>Resumo / Teor da Comunicação</Label>
                <Input
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Descreva a intimação ou publicação recebida..."
                  required
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit" size="sm">Registrar na Fila</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {["all", "nova", "classificada", "em_revisao", "vinculada", "descartada"].map(
          (st) => (
            <Button
              key={st}
              size="sm"
              variant={statusFilter === st ? "default" : "outline"}
              onClick={() => setStatusFilter(st)}
            >
              {st === "all" ? "Todas" : st}
            </Button>
          ),
        )}
      </div>

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : items.length === 0 ? (
        <LegalEmptyState
          title="Fila vazia para o filtro selecionado"
          description="Registre uma comunicação manual ou altere o filtro de status."
        />
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <Card key={c.id} className="border-border bg-card">
              <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Inbox className="h-4 w-4 text-primary" />
                    <StatusPill label={c.communication_kind} tone="primary" />
                    <StatusPill label={c.source_name.toUpperCase()} tone="neutral" />
                    <StatusPill
                      label={c.queue_status}
                      tone={
                        c.queue_status === "vinculada"
                          ? "success"
                          : c.queue_status === "descartada"
                            ? "danger"
                            : "warning"
                      }
                    />
                  </div>
                  <p className="text-sm font-medium text-foreground">{c.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    ID: {c.external_identifier ?? "—"} · Disponib.: {formatDateBr(c.available_date)} · Publicação: {formatDateBr(c.publication_date)} · Ciência: {formatDateBr(c.acknowledgement_date)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.queue_status === "nova" ? (
                    <Button size="sm" variant="outline" onClick={() => handleTransition(c.id, "em_revisao")}>
                      Enviar p/ Revisão
                    </Button>
                  ) : null}
                  {c.queue_status !== "vinculada" && c.queue_status !== "descartada" ? (
                    <>
                      <Button size="sm" onClick={() => handleTransition(c.id, "vinculada")}>
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                        Vincular
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleTransition(c.id, "descartada")}>
                        <XCircle className="mr-1 h-3.5 w-3.5" />
                        Descartar
                      </Button>
                    </>
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
