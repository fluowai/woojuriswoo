"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Download, Plus } from "lucide-react";
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
import type { LegalHearing } from "@/lib/legal/types";

export default function AgendaPage() {
  const { userId } = useDemoPersona();
  const [hearings, setHearings] = useState<LegalHearing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<LegalHearing["event_type"]>("audiencia");
  const [modality, setModality] = useState<LegalHearing["modality"]>("remota");
  const [startsAt, setStartsAt] = useState("2026-11-28T14:00");
  const [location, setLocation] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<{ hearings: LegalHearing[] }>("/api/legal/deadlines");
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar agenda", status: res.status });
    } else {
      setHearings(res.data?.hearings ?? []);
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
    const res = await legalFetch("/api/legal/deadlines", {
      method: "PUT",
      body: JSON.stringify({
        kind: "hearing",
        payload: {
          matter_id: "mat-civel-01",
          title,
          event_type: eventType,
          modality,
          starts_at: new Date(startsAt).toISOString(),
          location_or_link: location || undefined,
        },
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Compromisso jurídico agendado com resumo mínimo para exportação.");
    setTitle("");
    setLocation("");
    setShowCreate(false);
    load();
  };

  // Exporta ICS com descrição mínima aprovada (nunca vaza estratégia ou dados sigilosos em convites externos!)
  const exportMinimalIcs = (h: LegalHearing) => {
    const dtStart = h.starts_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const dtEnd = h.ends_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//WooJuris//Agenda Juridica//PT-BR",
      "BEGIN:VEVENT",
      `UID:${h.id}@woojuris.local`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${h.public_minimal_summary}`,
      `LOCATION:${h.location_or_link ?? "Confirmar internamente"}`,
      "DESCRIPTION:Compromisso exportado com descricao minima aprovada (LGPD/Sigilo).",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${h.id}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Arquivo .ics exportado com descrição mínima segura.");
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Agenda Jurídica & Consultas"
        description="Audiências, sustentações, perícias, diligências, reuniões e consultas presenciais/remotas. Exportação de calendário sempre usa descrição mínima aprovada."
        badge="Fase 2"
        actions={
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Novo Compromisso
          </Button>
        }
      />

      {showCreate ? (
        <Card className="border-primary/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Agendar Audiência / Consulta / Diligência</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <Label>Título interno</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div>
                <Label>Tipo</Label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as LegalHearing["event_type"])}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="audiencia">Audiência</option>
                  <option value="consulta">Consulta com Cliente</option>
                  <option value="sustentacao">Sustentação Oral</option>
                  <option value="pericia">Perícia</option>
                  <option value="diligencia">Diligência</option>
                  <option value="reuniao">Reunião</option>
                </select>
              </div>
              <div>
                <Label>Modalidade</Label>
                <select
                  value={modality}
                  onChange={(e) => setModality(e.target.value as LegalHearing["modality"])}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="remota">Remota</option>
                  <option value="presencial">Presencial</option>
                  <option value="hibrida">Híbrida</option>
                </select>
              </div>
              <div>
                <Label>Data e Hora</Label>
                <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
              </div>
              <div className="sm:col-span-3">
                <Label>Local ou Link da Sala</Label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="URL ou endereço" />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit" size="sm">Agendar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : hearings.length === 0 ? (
        <LegalEmptyState
          title="Nenhum compromisso na agenda"
          description="Agende audiências, consultas presenciais/remotas ou diligências acima."
        />
      ) : (
        <div className="space-y-3">
          {hearings.map((h) => (
            <Card key={h.id} className="border-border bg-card">
              <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-foreground">{h.title}</span>
                    <StatusPill label={h.event_type} tone="primary" />
                    <StatusPill label={h.modality} tone="neutral" />
                    <StatusPill label={h.status} tone="success" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Data: {formatDateBr(h.starts_at)} · Local/Link: {h.location_or_link ?? "—"} · Participantes: {h.participants.join(", ")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Resumo mínimo p/ convites externos: <em>{h.public_minimal_summary}</em>
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => exportMinimalIcs(h)}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Exportar .ICS Seguro
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
