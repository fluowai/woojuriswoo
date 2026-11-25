"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  FolderPlus,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
} from "lucide-react";
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
import {
  PRACTICE_AREAS,
  PRACTICE_AREA_LABELS,
  type LegalIntake,
  type PracticeArea,
} from "@/lib/legal/types";

const STAGE_LABELS: Record<LegalIntake["stage"], string> = {
  triagem: "Triagem",
  conflito: "Verif. Conflito",
  consulta: "Consulta",
  proposta: "Proposta",
  contratacao: "Contratação",
  convertido: "Convertido em Pasta",
  arquivado: "Arquivado",
};

export default function FunilJuridicoPage() {
  const { userId } = useDemoPersona();
  const [intakes, setIntakes] = useState<LegalIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState("");
  const [area, setArea] = useState<PracticeArea>("civel");
  const [origin, setOrigin] = useState<LegalIntake["origin_channel"]>("whatsapp");
  const [urgency, setUrgency] = useState<LegalIntake["reported_urgency"]>("media");
  const [opposing, setOpposing] = useState("");
  const [summary, setSummary] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (stageFilter !== "all") params.set("stage", stageFilter);
    if (q.trim()) params.set("q", q.trim());
    const res = await legalFetch<{ intakes: LegalIntake[] }>(
      `/api/legal/intakes?${params.toString()}`,
    );
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar funil", status: res.status });
    } else {
      setIntakes(res.data?.intakes ?? []);
    }
    setLoading(false);
  }, [q, stageFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await legalFetch<{ intake: LegalIntake }>("/api/legal/intakes", {
      method: "POST",
      body: JSON.stringify({
        title,
        practice_area: area,
        origin_channel: origin,
        reported_urgency: urgency,
        opposing_party_name: opposing || undefined,
        summary: summary || undefined,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Oportunidade registrada na fila de triagem.");
    setTitle("");
    setOpposing("");
    setSummary("");
    setShowCreate(false);
    load();
  };

  const handleConvert = async (intake: LegalIntake, restricted = false) => {
    const res = await legalFetch<{
      matter: { id: string; code: string };
      idempotentReplay: boolean;
    }>("/api/legal/intakes", {
      method: "PATCH",
      body: JSON.stringify({
        id: intake.id,
        action: "convert",
        idempotency_key: `ui-convert:${intake.id}`,
        is_restricted: restricted,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      res.data?.idempotentReplay
        ? `Conversão idempotente: pasta ${res.data.matter.code} já vinculada.`
        : `Pasta jurídica ${res.data?.matter.code} criada com trilha de auditoria!`,
    );
    load();
  };

  const handleArchiveOrReopen = async (
    intake: LegalIntake,
    action: "archive" | "reopen",
  ) => {
    const res = await legalFetch("/api/legal/intakes", {
      method: "PATCH",
      body: JSON.stringify({
        id: intake.id,
        action,
        reason: action === "archive" ? "Arquivado após triagem inicial" : undefined,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      action === "archive" ? "Oportunidade arquivada." : "Oportunidade reaberta.",
    );
    load();
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Funil Jurídico & Triagem"
        description="Recepção (WhatsApp, formulário, e-mail, manual) → triagem → conflito → consulta → proposta → conversão idempotente em pasta jurídica."
        badge="Fase 1"
        actions={
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nova Oportunidade
          </Button>
        }
      />

      {showCreate ? (
        <Card className="border-primary/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Registrar Atendimento / Oportunidade</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <Label>Título da demanda</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Ação revisional bancária — Empresa X"
                  required
                />
              </div>
              <div>
                <Label>Área jurídica</Label>
                <select
                  value={area}
                  onChange={(e) => setArea(e.target.value as PracticeArea)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  {PRACTICE_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {PRACTICE_AREA_LABELS[a]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Origem</Label>
                <select
                  value={origin}
                  onChange={(e) =>
                    setOrigin(e.target.value as LegalIntake["origin_channel"])
                  }
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="whatsapp">WhatsApp Business</option>
                  <option value="formulario">Formulário Web</option>
                  <option value="email">E-mail</option>
                  <option value="indicacao">Indicação</option>
                  <option value="manual">Manual / Presencial</option>
                </select>
              </div>
              <div>
                <Label>Urgência relatada</Label>
                <select
                  value={urgency}
                  onChange={(e) =>
                    setUrgency(e.target.value as LegalIntake["reported_urgency"])
                  }
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="baixa">Baixa</option>
                  <option value="media">Média</option>
                  <option value="alta">Alta</option>
                  <option value="critica">Crítica</option>
                </select>
              </div>
              <div>
                <Label>Contraparte (para conflito)</Label>
                <Input
                  value={opposing}
                  onChange={(e) => setOpposing(e.target.value)}
                  placeholder="Nome ou razão social adversa"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Resumo da triagem</Label>
                <Input
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Síntese inicial do relato e documentos solicitados"
                />
              </div>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                <Button type="submit" size="sm">
                  Salvar Oportunidade
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreate(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por título, contraparte ou resumo..."
            className="pl-8"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Todas as etapas</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : intakes.length === 0 ? (
        <LegalEmptyState
          title="Nenhuma oportunidade encontrada"
          description="Registre um novo atendimento ou ajuste os filtros."
        />
      ) : (
        <div className="grid gap-3">
          {intakes.map((intake) => (
            <Card key={intake.id} className="border-border bg-card">
              <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{intake.title}</span>
                    <StatusPill label={STAGE_LABELS[intake.stage]} tone="primary" />
                    <StatusPill
                      label={`Conflito: ${intake.conflict_status}`}
                      tone={
                        intake.conflict_status === "liberado" ||
                        intake.conflict_status === "liberado_com_excecao"
                          ? "success"
                          : intake.conflict_status === "bloqueado"
                            ? "danger"
                            : "warning"
                      }
                    />
                    <StatusPill
                      label={PRACTICE_AREA_LABELS[intake.practice_area]}
                      tone="neutral"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Origem: <strong>{intake.origin_channel}</strong> · Urgência:{" "}
                    <strong>{intake.reported_urgency}</strong> · Fila: {intake.queue_name}
                    {intake.opposing_party_name
                      ? ` · Contraparte: ${intake.opposing_party_name}`
                      : ""}
                    {intake.proposal_value_cents
                      ? ` · Proposta: ${formatBrl(intake.proposal_value_cents)}`
                      : ""}
                  </p>
                  {intake.summary ? (
                    <p className="text-xs text-foreground/80">{intake.summary}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {intake.converted_matter_id ? (
                    <Link href={`/matters/${intake.converted_matter_id}`}>
                      <Button size="sm" variant="outline">
                        <CheckCircle2 className="mr-1.5 h-4 w-4 text-emerald-600" />
                        Abrir Pasta
                        <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  ) : intake.stage !== "arquivado" ? (
                    <>
                      <Link href={`/conflicts?intake=${intake.id}&name=${encodeURIComponent(intake.opposing_party_name || intake.title)}`}>
                        <Button size="sm" variant="outline">
                          <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                          Conflito
                        </Button>
                      </Link>
                      <Button size="sm" onClick={() => handleConvert(intake, false)}>
                        <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                        Converter em Pasta
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleArchiveOrReopen(intake, "archive")}
                      >
                        <Archive className="mr-1 h-3.5 w-3.5" />
                        Arquivar
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleArchiveOrReopen(intake, "reopen")}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Reabrir
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
