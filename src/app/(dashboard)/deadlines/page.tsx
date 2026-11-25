"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Plus, RefreshCw } from "lucide-react";
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
import type {
  CourtCalendar,
  LegalDeadline,
  LegalTask,
  ProceduralRegime,
} from "@/lib/legal/types";

export default function DeadlinesPage() {
  const { userId } = useDemoPersona();
  const [deadlines, setDeadlines] = useState<LegalDeadline[]>([]);
  const [calendars, setCalendars] = useState<CourtCalendar[]>([]);
  const [tasks, setTasks] = useState<LegalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const [showCalc, setShowCalc] = useState(false);
  const [title, setTitle] = useState("");
  const [regime, setRegime] = useState<ProceduralRegime>("cpc_dias_uteis");
  const [days, setDays] = useState("15");
  const [startDate, setStartDate] = useState("2026-11-22");
  const [calendarId, setCalendarId] = useState("cal-tjsc-fln");
  const [secondReviewer, setSecondReviewer] = useState(false);
  const [evidenceInputs, setEvidenceInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<{
      deadlines: LegalDeadline[];
      calendars: CourtCalendar[];
      tasks: LegalTask[];
    }>("/api/legal/deadlines");
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar prazos", status: res.status });
    } else {
      setDeadlines(res.data?.deadlines ?? []);
      setCalendars(res.data?.calendars ?? []);
      setTasks(res.data?.tasks ?? []);
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
    const res = await legalFetch<{ deadline: LegalDeadline }>("/api/legal/deadlines", {
      method: "POST",
      body: JSON.stringify({
        matter_id: "mat-civel-01",
        calendar_id: calendarId || undefined,
        title,
        procedural_regime: regime,
        counting_days: Number(days) || 15,
        start_date: startDate,
        reference_event: `Termo inicial em ${startDate}`,
        requires_second_reviewer: secondReviewer,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `Prazo calculado como "${res.data?.deadline.status}" (exige validação humana para confirmar).`,
    );
    setTitle("");
    setShowCalc(false);
    load();
  };

  const handleConfirm = async (dl: LegalDeadline) => {
    const evidence =
      evidenceInputs[dl.id] ||
      "Conferido diretamente no Diário/eproc pelo advogado responsável";
    const res = await legalFetch("/api/legal/deadlines", {
      method: "PATCH",
      body: JSON.stringify({
        id: dl.id,
        action: "confirm",
        evidence_note: evidence,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Validação registrada e alertas reprogramados sem duplicação.");
    load();
  };

  const handleTaskStatus = async (taskId: string, status: LegalTask["status"]) => {
    const res = await legalFetch("/api/legal/deadlines", {
      method: "PUT",
      body: JSON.stringify({ kind: "task_status", taskId, status }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    load();
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Prazos Processuais & Quadro de Tarefas"
        description="Workflow sugerido → em revisão → confirmado → cumprido/recalculado. Memória de cálculo por regime (CPC, Penal, CLT, Administrativo), calendários forenses e revisão por 2ª pessoa."
        badge="Fase 2"
        actions={
          <Button size="sm" onClick={() => setShowCalc((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Calcular / Lançar Prazo
          </Button>
        }
      />

      {showCalc ? (
        <Card className="border-primary/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Calculadora de Prazo com Memória de Cálculo</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-3">
                <Label>Descrição do Prazo</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Agravo de Instrumento — Decisão interlocutória"
                  required
                />
              </div>
              <div>
                <Label>Regime de Contagem</Label>
                <select
                  value={regime}
                  onChange={(e) => setRegime(e.target.value as ProceduralRegime)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="cpc_dias_uteis">Cível — CPC (Dias Úteis)</option>
                  <option value="penal_dias_corridos">Penal — CPP (Dias Corridos)</option>
                  <option value="trabalhista_clt">Trabalhista — CLT (Dias Úteis)</option>
                  <option value="administrativo">Administrativo (Dias Corridos)</option>
                  <option value="manual">Manual Justificado</option>
                </select>
              </div>
              <div>
                <Label>Dias</Label>
                <Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} required />
              </div>
              <div>
                <Label>Termo Inicial (Publicação / Ciência)</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div>
                <Label>Calendário Forense</Label>
                <select
                  value={calendarId}
                  onChange={(e) => setCalendarId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="">(Sem calendário — revisão obrigatória)</option>
                  {calendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.name} {cal.is_validated ? "✓" : "(Não validado)"}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs sm:col-span-2">
                <input
                  type="checkbox"
                  checked={secondReviewer}
                  onChange={(e) => setSecondReviewer(e.target.checked)}
                />
                <span>Exigir revisão por 2ª pessoa (dupla conferência)</span>
              </label>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit" size="sm">Calcular Sugestão de Prazo</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : deadlines.length === 0 ? (
        <LegalEmptyState
          title="Nenhum prazo registrado"
          description="Use a calculadora acima para sugerir um prazo com memória de cálculo auditável."
        />
      ) : (
        <div className="space-y-3">
          {deadlines.map((dl) => (
            <Card key={dl.id} className="border-border bg-card">
              <CardContent className="space-y-2.5 pt-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-foreground">{dl.title}</span>
                      <StatusPill
                        label={dl.status}
                        tone={
                          dl.status === "confirmado" || dl.status === "cumprido"
                            ? "success"
                            : "warning"
                        }
                      />
                      {dl.requires_second_reviewer ? (
                        <StatusPill label="Dupla Revisão" tone="primary" />
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Prazo Interno: <strong className="text-primary">{formatDateBr(dl.internal_due_date)}</strong> · Prazo Legal: <strong>{formatDateBr(dl.legal_due_date)}</strong> · Regime: {dl.procedural_regime} · Rev. #{dl.revision_number}
                    </p>
                  </div>
                </div>

                {dl.calculation_memory.steps.length > 0 ? (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                    <p className="font-semibold text-foreground">Memória de cálculo:</p>
                    {dl.calculation_memory.steps.map((st, idx) => (
                      <p key={idx}>• {st}</p>
                    ))}
                    {dl.calculation_memory.warnings.map((w, idx) => (
                      <p key={idx} className="font-medium text-amber-700 dark:text-amber-300">
                        ⚠ {w}
                      </p>
                    ))}
                  </div>
                ) : null}

                {dl.status === "sugerido" || dl.status === "em_revisao" || dl.status === "recalculado" ? (
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                    <Input
                      placeholder="Evidência da conferência (ex.: conferido no DJE/eproc evento 48)..."
                      value={evidenceInputs[dl.id] ?? ""}
                      onChange={(e) =>
                        setEvidenceInputs((prev) => ({ ...prev, [dl.id]: e.target.value }))
                      }
                      className="flex-1"
                    />
                    <Button size="sm" onClick={() => handleConfirm(dl)}>
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Validar / Confirmar Prazo
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>Quadro de Tarefas da Equipe ({tasks.length})</span>
            <Button variant="ghost" size="sm" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.map((tsk) => (
            <div
              key={tsk.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card-2 px-3 py-2 text-xs"
            >
              <div>
                <p className="font-medium text-foreground">{tsk.title}</p>
                <p className="text-muted-foreground">
                  Prioridade: {tsk.priority} · Vencimento: {formatDateBr(tsk.due_date)} · Horas: {tsk.logged_minutes}/{tsk.estimated_minutes} min
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusPill label={tsk.status} tone={tsk.status === "concluida" ? "success" : "neutral"} />
                {tsk.status !== "concluida" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTaskStatus(tsk.id, "concluida")}
                  >
                    Concluir
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
