"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Clock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  formatDateBr,
  legalFetch,
  useDemoPersona,
} from "@/components/legal/legal-client";
import { StatusPill } from "@/components/legal/legal-ui";
import type {
  CourtCase,
  LegalDeadline,
  LegalHearing,
  LegalTask,
} from "@/lib/legal/types";

interface TodayData {
  deadlines: LegalDeadline[];
  hearings: LegalHearing[];
  tasks: LegalTask[];
  cases: CourtCase[];
}

export function TodayLegalPanel() {
  const { userId } = useDemoPersona();
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [dlRes, casesRes] = await Promise.all([
      legalFetch<{
        deadlines: LegalDeadline[];
        hearings: LegalHearing[];
        tasks: LegalTask[];
      }>("/api/legal/deadlines"),
      legalFetch<{ cases: CourtCase[] }>("/api/legal/cases"),
    ]);
    setData({
      deadlines: dlRes.ok && dlRes.data ? dlRes.data.deadlines : [],
      hearings: dlRes.ok && dlRes.data ? dlRes.data.hearings : [],
      tasks: dlRes.ok && dlRes.data ? dlRes.data.tasks : [],
      cases: casesRes.ok && casesRes.data ? casesRes.data.cases : [],
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const confirmedDeadlines = (data?.deadlines ?? []).filter(
    (d) => d.status === "confirmado",
  );
  const pendingValidation = (data?.deadlines ?? []).filter(
    (d) => d.status === "sugerido" || d.status === "em_revisao",
  );
  const upcomingHearings = (data?.hearings ?? []).filter(
    (h) => h.status !== "cancelada" && h.status !== "realizada",
  );
  const openTasks = (data?.tasks ?? []).filter(
    (t) => t.status !== "concluida" && t.status !== "cancelada",
  );
  const syncAlerts = (data?.cases ?? [])
    .flatMap((c) =>
      c.source_records.map((s) => ({ caseNumber: c.cnj_number || c.legacy_number || c.id, ...s })),
    )
    .filter((s) =>
      ["atrasado", "erro_auth", "rate_limited", "indisponivel", "parcial"].includes(
        s.sync_status,
      ),
    );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">
            Visão Hoje — Operação Jurídica
          </h2>
          <p className="text-xs text-muted-foreground">
            Prazos confirmados, pendências de validação humana, audiências, tarefas e alertas de sincronização judicial.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Link href="/funil">
            <Button size="sm">Novo Atendimento</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="border-border bg-card">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              Prazos Confirmados
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {confirmedDeadlines.length}
            </div>
            <Link href="/deadlines" className="mt-1 inline-flex items-center text-xs text-primary hover:underline">
              Abrir prazos <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center justify-between text-xs font-medium text-primary">
              Pendências de Validação
              <Clock className="h-4 w-4 text-primary" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {pendingValidation.length}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Exigem conferência humana com evidência
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              Audiências &amp; Agenda
              <CalendarDays className="h-4 w-4 text-primary" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {upcomingHearings.length}
            </div>
            <Link href="/agenda" className="mt-1 inline-flex items-center text-xs text-primary hover:underline">
              Ver agenda <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              Tarefas em Aberto
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {openTasks.length}
            </div>
            <Link href="/deadlines" className="mt-1 inline-flex items-center text-xs text-primary hover:underline">
              Quadro de trabalho <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center justify-between text-xs font-medium text-amber-800 dark:text-amber-300">
              Alertas de Sincronização
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {syncAlerts.length}
            </div>
            <Link href="/cases" className="mt-1 inline-flex items-center text-xs text-primary hover:underline">
              Ver DataJud/Fontes <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Prazos &amp; Pendências Prioritárias
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.deadlines ?? []).slice(0, 4).map((dl) => (
              <div
                key={dl.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card-2 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{dl.title}</p>
                  <p className="text-muted-foreground">
                    Interno: {formatDateBr(dl.internal_due_date)} · Legal: {formatDateBr(dl.legal_due_date)}
                  </p>
                </div>
                <StatusPill
                  label={dl.status}
                  tone={
                    dl.status === "confirmado"
                      ? "success"
                      : dl.status === "em_revisao" || dl.status === "sugerido"
                        ? "warning"
                        : "neutral"
                  }
                />
              </div>
            ))}
            {(data?.deadlines ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum prazo visível para o perfil atual.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Falhas / Atrasos de Sincronização &amp; Próximas Audiências
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {syncAlerts.map((al) => (
              <div
                key={al.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {al.caseNumber} ({al.degree})
                  </p>
                  <p className="text-muted-foreground">{al.court_organ}</p>
                </div>
                <StatusPill label={`DataJud: ${al.sync_status}`} tone="warning" />
              </div>
            ))}
            {upcomingHearings.slice(0, 2).map((hr) => (
              <div
                key={hr.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card-2 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{hr.title}</p>
                  <p className="text-muted-foreground">
                    {formatDateBr(hr.starts_at)} · {hr.modality}
                  </p>
                </div>
                <StatusPill label={hr.event_type} tone="primary" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
