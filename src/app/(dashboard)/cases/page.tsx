"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileCheck2, Landmark, Plus, RefreshCw, Search } from "lucide-react";
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
import { PILOT_CNJ_FIXTURES } from "@/lib/legal/datajud";
import type { CourtCase, ProtocolReceipt } from "@/lib/legal/types";

export default function CasesPage() {
  const { userId } = useDemoPersona();
  const [cases, setCases] = useState<CourtCase[]>([]);
  const [protocols, setProtocols] = useState<ProtocolReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const [cnjQuery, setCnjQuery] = useState<string>(PILOT_CNJ_FIXTURES.TJSC);
  const [tribunalCode, setTribunalCode] = useState("TJSC");
  const [searchingDj, setSearchingDj] = useState(false);
  const [lastDjMessage, setLastDjMessage] = useState<string | null>(null);

  const [showProtocol, setShowProtocol] = useState(false);
  const [protNumber, setProtNumber] = useState("");
  const [protFile, setProtFile] = useState("recibo-protocolo-eproc.pdf");
  const [protMatterId, setProtMatterId] = useState("mat-civel-01");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<{
      cases: CourtCase[];
      protocols: ProtocolReceipt[];
    }>("/api/legal/cases");
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar processos", status: res.status });
    } else {
      setCases(res.data?.cases ?? []);
      setProtocols(res.data?.protocols ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handleDataJudQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchingDj(true);
    const res = await legalFetch<{
      result: { status: string; mode: string; message: string; hits: unknown[] };
      reconciliationStats?: { inserted: number; duplicatesSkipped: number } | null;
    }>("/api/legal/cases", {
      method: "PUT",
      body: JSON.stringify({
        cnj: cnjQuery,
        tribunalCode,
        matterId: "mat-civel-01",
      }),
    });
    setSearchingDj(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const msg = res.data?.result.message ?? "Consulta concluída.";
    setLastDjMessage(msg);
    toast.success(msg);
    load();
  };

  const handleRegisterProtocol = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await legalFetch("/api/legal/cases", {
      method: "PATCH",
      body: JSON.stringify({
        matter_id: protMatterId,
        case_id: cases[0]?.id,
        protocol_number: protNumber,
        receipt_filename: protFile,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Protocolo manual registrado com recibo e hash SHA-256.");
    setProtNumber("");
    setShowProtocol(false);
    load();
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Processos & API Pública DataJud (CNJ)"
        description="Validação CNJ 20 dígitos + DV, piloto homologado TJSC / TRF4 / TRT12, múltiplas instâncias, deduplicação de movimentos e protocolos manuais com recibo."
        badge="Fase 2"
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowProtocol((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Registrar Protocolo Manual
          </Button>
        }
      />

      <Card className="border-primary/30 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-primary" />
            Consulta DataJud CNJ (Metadados Públicos — Nenhum Movimento Confirma Prazo Sozinho)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleDataJudQuery} className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label>Número CNJ (20 dígitos)</Label>
              <Input
                value={cnjQuery}
                onChange={(e) => setCnjQuery(e.target.value)}
                placeholder="0000000-00.0000.0.00.0000"
              />
            </div>
            <div>
              <Label>Tribunal (Catálogo Oficial)</Label>
              <select
                value={tribunalCode}
                onChange={(e) => setTribunalCode(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
              >
                <option value="TJSC">TJSC (Piloto)</option>
                <option value="TRF4">TRF4 (Piloto)</option>
                <option value="TRT12">TRT12 (Piloto)</option>
                <option value="TJSP">TJSP</option>
                <option value="STJ">STJ</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" size="sm" className="w-full" disabled={searchingDj}>
                {searchingDj ? (
                  <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-1.5 h-4 w-4" />
                )}
                Consultar &amp; Sincronizar
              </Button>
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Fixtures piloto:</span>
            <button
              type="button"
              className="underline hover:text-primary"
              onClick={() => {
                setCnjQuery(PILOT_CNJ_FIXTURES.TJSC);
                setTribunalCode("TJSC");
              }}
            >
              TJSC ({PILOT_CNJ_FIXTURES.TJSC})
            </button>
            <button
              type="button"
              className="underline hover:text-primary"
              onClick={() => {
                setCnjQuery(PILOT_CNJ_FIXTURES.TRF4);
                setTribunalCode("TRF4");
              }}
            >
              TRF4 ({PILOT_CNJ_FIXTURES.TRF4})
            </button>
            <button
              type="button"
              className="underline hover:text-primary"
              onClick={() => {
                setCnjQuery(PILOT_CNJ_FIXTURES.TRT12);
                setTribunalCode("TRT12");
              }}
            >
              TRT12 ({PILOT_CNJ_FIXTURES.TRT12})
            </button>
          </div>

          {lastDjMessage ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
              {lastDjMessage}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {showProtocol ? (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Novo Protocolo Manual com Recibo</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegisterProtocol} className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Número do Protocolo</Label>
                <Input
                  value={protNumber}
                  onChange={(e) => setProtNumber(e.target.value)}
                  placeholder="EPROC-2026-00012345"
                  required
                />
              </div>
              <div>
                <Label>Arquivo do Recibo</Label>
                <Input
                  value={protFile}
                  onChange={(e) => setProtFile(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>ID da Pasta</Label>
                <Input
                  value={protMatterId}
                  onChange={(e) => setProtMatterId(e.target.value)}
                  required
                />
              </div>
              <div className="sm:col-span-3">
                <Button type="submit" size="sm">Gravar Protocolo + Hash</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : cases.length === 0 ? (
        <LegalEmptyState
          title="Nenhum processo cadastrado"
          description="Consulte pelo DataJud acima ou registre um processo manualmente."
        />
      ) : (
        <div className="space-y-3">
          {cases.map((c) => (
            <Card key={c.id} className="border-border bg-card">
              <CardContent className="space-y-2 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-semibold text-foreground">
                      {c.cnj_number || c.legacy_number}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.tribunal_code} · {c.degree} · {c.court_organ} · {c.case_class ?? "Classe não informada"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusPill label={c.judicial_system.toUpperCase()} tone="primary" />
                    <StatusPill label={`${c.movements.length} mov.`} tone="neutral" />
                  </div>
                </div>

                {c.source_records.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {c.source_records.map((sr) => (
                      <div
                        key={sr.id}
                        className="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px]"
                      >
                        <strong>{sr.source_name.toUpperCase()} {sr.degree}</strong>: {sr.sync_status}
                        {sr.source_updated_at ? ` · Fonte: ${formatDateBr(sr.source_updated_at)}` : ""}
                      </div>
                    ))}
                  </div>
                ) : null}

                {c.movements.slice(0, 3).map((m) => (
                  <div
                    key={m.id}
                    className="rounded-md border border-border/60 bg-card-2 px-3 py-1.5 text-xs"
                  >
                    <span className="font-medium text-foreground">{formatDateBr(m.occurred_at)}</span>{" "}
                    — {m.title}
                    {m.received_out_of_order ? (
                      <span className="ml-2 text-amber-600">[Recebido fora de ordem]</span>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {protocols.length > 0 ? (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileCheck2 className="h-4 w-4 text-primary" />
              Protocolos Manuais com Comprovante ({protocols.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {protocols.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs"
              >
                <div>
                  <p className="font-semibold text-foreground">{p.protocol_number}</p>
                  <p className="text-muted-foreground">
                    {p.system_name} · Recibo: {p.receipt_filename} · SHA-256: {p.receipt_hash.slice(0, 14)}…
                  </p>
                </div>
                <StatusPill label={p.protocol_type} tone="success" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
