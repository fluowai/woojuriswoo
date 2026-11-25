"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Lock, Plus, Search, ShieldAlert } from "lucide-react";
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
  MATTER_TYPE_LABELS,
  PRACTICE_AREAS,
  PRACTICE_AREA_LABELS,
  type Matter,
  type MatterType,
  type PracticeArea,
} from "@/lib/legal/types";

export default function MattersPage() {
  const { userId } = useDemoPersona();
  const [matters, setMatters] = useState<Matter[]>([]);
  const [hiddenRestricted, setHiddenRestricted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState("");
  const [matterType, setMatterType] = useState<MatterType>("extrajudicial");
  const [area, setArea] = useState<PracticeArea>("consultivo");
  const [isRestricted, setIsRestricted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (typeFilter !== "all") params.set("type", typeFilter);
    const res = await legalFetch<{
      matters: Matter[];
      hiddenRestrictedCount: number;
    }>(`/api/legal/matters?${params.toString()}`);
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar pastas", status: res.status });
    } else {
      setMatters(res.data?.matters ?? []);
      setHiddenRestricted(res.data?.hiddenRestrictedCount ?? 0);
    }
    setLoading(false);
  }, [q, typeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await legalFetch<{ matter: Matter }>("/api/legal/matters", {
      method: "POST",
      body: JSON.stringify({
        title,
        matter_type: matterType,
        practice_area: area,
        is_restricted: isRestricted,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Pasta ${res.data?.matter.code} criada!`);
    setTitle("");
    setShowCreate(false);
    load();
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Pastas Jurídicas"
        description="Gestão de casos judiciais, extrajudiciais, consultoria, pareceres e cartório (sem exigir CNJ). Pastas restritas aplicam barreira absoluta de sigilo."
        badge="Fases 1–3"
        actions={
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nova Pasta Jurídica
          </Button>
        }
      />

      {hiddenRestricted > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            Existem <strong>{hiddenRestricted}</strong> pasta(s) sob barreira de sigilo ocultas para o perfil atual por ausência de concessão explícita (inclusive para sócio/admin sem grant).
          </span>
        </div>
      ) : null}

      {showCreate ? (
        <Card className="border-primary/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Abrir Nova Pasta (Judicial ou Extrajudicial sem CNJ)</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <Label>Título da pasta</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Parecer tributário — Operação interestadual"
                  required
                />
              </div>
              <div>
                <Label>Modalidade</Label>
                <select
                  value={matterType}
                  onChange={(e) => setMatterType(e.target.value as MatterType)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  {Object.entries(MATTER_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Área</Label>
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
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={isRestricted}
                  onChange={(e) => setIsRestricted(e.target.checked)}
                />
                <span>Ativar barreira de sigilo / acesso restrito (somente lista explícita)</span>
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" size="sm">Criar Pasta</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)}>
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
            placeholder="Buscar por código ou título da pasta..."
            className="pl-8"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Todas modalidades</option>
          {Object.entries(MATTER_TYPE_LABELS).map(([k, v]) => (
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
      ) : matters.length === 0 ? (
        <LegalEmptyState
          title="Nenhuma pasta autorizada encontrada"
          description="Verifique o perfil ativo ou abra uma nova pasta jurídica."
        />
      ) : (
        <div className="grid gap-3">
          {matters.map((m) => (
            <Card key={m.id} className="border-border bg-card">
              <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">
                      {m.code}
                    </span>
                    <span className="font-semibold text-foreground">{m.title}</span>
                    <StatusPill label={MATTER_TYPE_LABELS[m.matter_type]} tone="neutral" />
                    <StatusPill label={PRACTICE_AREA_LABELS[m.practice_area]} tone="primary" />
                    {m.is_restricted ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700">
                        <Lock className="h-3 w-3" /> Sigilo Restrito
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Status: <strong>{m.status}</strong> · Prioridade: <strong>{m.priority}</strong>
                    {m.claim_value_cents
                      ? ` · Valor da causa: ${formatBrl(m.claim_value_cents)}`
                      : ""}
                    {m.next_step ? ` · Próximo passo: ${m.next_step}` : ""}
                  </p>
                </div>
                <Link href={`/matters/${m.id}`}>
                  <Button size="sm" variant="outline">
                    Abrir Pasta
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
