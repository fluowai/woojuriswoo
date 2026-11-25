"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Search, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { legalFetch, useDemoPersona } from "@/components/legal/legal-client";
import {
  LegalEmptyState,
  LegalErrorState,
  LegalLoadingState,
  LegalPageHeader,
  StatusPill,
} from "@/components/legal/legal-ui";
import type { ConflictCheck } from "@/lib/legal/types";

export default function ConflictsPage() {
  return (
    <Suspense fallback={null}>
      <ConflictsInner />
    </Suspense>
  );
}

function ConflictsInner() {
  const searchParams = useSearchParams();
  const { userId } = useDemoPersona();
  const [checks, setChecks] = useState<ConflictCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const [queryName, setQueryName] = useState(searchParams.get("name") ?? "");
  const [queryDocument, setQueryDocument] = useState("");
  const [queryGroup, setQueryGroup] = useState("");
  const [intakeId] = useState(searchParams.get("intake") ?? "");
  const [justifications, setJustifications] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<{ conflictChecks: ConflictCheck[] }>(
      "/api/legal/conflicts",
    );
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar conflitos", status: res.status });
    } else {
      setChecks(res.data?.conflictChecks ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await legalFetch<{ conflictCheck: ConflictCheck; blocksHiring: boolean }>(
      "/api/legal/conflicts",
      {
        method: "POST",
        body: JSON.stringify({
          queryName,
          queryDocument: queryDocument || undefined,
          queryEconomicGroup: queryGroup || undefined,
          intakeId: intakeId || undefined,
        }),
      },
    );
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      res.data?.blocksHiring
        ? "Candidato(s) encontrado(s) — contratação bloqueada até decisão formal."
        : "Nenhum conflito encontrado na base autorizada.",
    );
    load();
  };

  const handleDecide = async (
    checkId: string,
    decision: "falso_positivo" | "conflito_confirmado" | "excecao_autorizada",
  ) => {
    const justification = justifications[checkId] ?? "";
    const res = await legalFetch("/api/legal/conflicts", {
      method: "PATCH",
      body: JSON.stringify({ id: checkId, decision, justification }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Decisão "${decision}" registrada na trilha de auditoria.`);
    load();
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Verificação de Conflitos de Interesses"
        description="Pesquisa por CPF/CNPJ/OAB, nome normalizado, aliases, grupo econômico e partes adversas. Itens sob sigilo retornam apenas sinal mínimo."
        badge="Fase 1"
      />

      <Card className="border-primary/30 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Nova Pesquisa de Conflito</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Nome / Razão Social / Contraparte</Label>
              <Input
                value={queryName}
                onChange={(e) => setQueryName(e.target.value)}
                placeholder="Ex.: Roberto Alencar Silva ou Banco Horizonte"
              />
            </div>
            <div>
              <Label>CPF / CNPJ</Label>
              <Input
                value={queryDocument}
                onChange={(e) => setQueryDocument(e.target.value)}
                placeholder="321.654.987-00"
              />
            </div>
            <div>
              <Label>Grupo Econômico</Label>
              <Input
                value={queryGroup}
                onChange={(e) => setQueryGroup(e.target.value)}
                placeholder="Ex.: Holding Alencar"
              />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                <Search className="mr-1.5 h-4 w-4" />
                Executar Varredura de Conflito
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : checks.length === 0 ? (
        <LegalEmptyState
          title="Nenhuma verificação registrada"
          description="Execute uma pesquisa acima para auditar possíveis conflitos antes da contratação."
        />
      ) : (
        <div className="space-y-3">
          {checks.map((chk) => (
            <Card key={chk.id} className="border-border bg-card">
              <CardContent className="space-y-3 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">
                      Pesquisa: {chk.query_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Motivo: {chk.trigger_reason} · Candidatos: {chk.candidates.length}
                      {chk.decision_justification
                        ? ` · Justificativa: ${chk.decision_justification}`
                        : ""}
                    </p>
                  </div>
                  <StatusPill
                    label={chk.status}
                    tone={
                      chk.status === "sem_conflito" || chk.status === "falso_positivo"
                        ? "success"
                        : chk.status === "conflito_confirmado"
                          ? "danger"
                          : "warning"
                    }
                  />
                </div>

                {chk.candidates.length > 0 ? (
                  <div className="space-y-1.5">
                    {chk.candidates.map((cand) => (
                      <div
                        key={cand.id}
                        className={`rounded-lg border px-3 py-2 text-xs ${
                          cand.is_under_secrecy
                            ? "border-amber-500/40 bg-amber-500/10"
                            : "border-border bg-muted/40"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-foreground">
                            {cand.minimal_signal}
                          </span>
                          <StatusPill
                            label={
                              cand.is_under_secrecy
                                ? "SINAL MÍNIMO (SIGILO)"
                                : `${cand.match_type} (${Math.round(cand.similarity_score * 100)}%)`
                            }
                            tone={cand.is_under_secrecy ? "warning" : "neutral"}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {chk.status === "pendente_revisao" ? (
                  <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                    <Input
                      placeholder="Justificativa formal obrigatória (mín. 8 caracteres)..."
                      value={justifications[chk.id] ?? ""}
                      onChange={(e) =>
                        setJustifications((prev) => ({
                          ...prev,
                          [chk.id]: e.target.value,
                        }))
                      }
                      className="flex-1"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDecide(chk.id, "falso_positivo")}
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                        Falso Positivo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDecide(chk.id, "excecao_autorizada")}
                      >
                        <ShieldAlert className="mr-1 h-3.5 w-3.5 text-amber-600" />
                        Exceção Autorizada
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDecide(chk.id, "conflito_confirmado")}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" />
                        Bloquear Conflito
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
