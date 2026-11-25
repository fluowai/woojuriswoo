"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { legalFetch, useDemoPersona } from "@/components/legal/legal-client";
import {
  LegalEmptyState,
  LegalErrorState,
  LegalLoadingState,
  LegalPageHeader,
  StatusPill,
} from "@/components/legal/legal-ui";
import type { PersonEntity } from "@/lib/legal/types";

type ClientRow = PersonEntity & { cpf_cnpj_masked?: string };

export default function ClientsPage() {
  const { userId } = useDemoPersona();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showCsv, setShowCsv] = useState(false);

  const [fullName, setFullName] = useState("");
  const [personType, setPersonType] = useState<"PF" | "PJ">("PF");
  const [doc, setDoc] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [group, setGroup] = useState("");

  const [csvText, setCsvText] = useState(
    "nome;tipo;documento;email;telefone\nJoão da Silva Exemplo;PF;12345678901;joao@example.com;+5548999001122\nEmpresa Exemplo Sul Ltda;PJ;11222333000144;contato@sul.example;+554832220000",
  );
  const [csvPreview, setCsvPreview] = useState<{
    totalValidRows: number;
    inconsistencies: Array<{ rowNumber: number; reason: string }>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (typeFilter !== "all") params.set("type", typeFilter);
    const res = await legalFetch<{ clients: ClientRow[] }>(
      `/api/legal/clients?${params.toString()}`,
    );
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar clientes", status: res.status });
    } else {
      setClients(res.data?.clients ?? []);
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
    const res = await legalFetch("/api/legal/clients", {
      method: "POST",
      body: JSON.stringify({
        full_name: fullName,
        person_type: personType,
        cpf_cnpj: doc || null,
        phone: phone || null,
        email: email || null,
        economic_group: group || null,
        is_client: true,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Pessoa/parte cadastrada com sucesso.");
    setFullName("");
    setDoc("");
    setPhone("");
    setEmail("");
    setGroup("");
    setShowCreate(false);
    load();
  };

  const handleCsv = async (mode: "preview" | "execute") => {
    const res = await legalFetch<{
      totalValidRows?: number;
      inconsistencies?: Array<{ rowNumber: number; reason: string }>;
      batch?: { importedKeys: string[]; duplicatesSkipped: number };
    }>("/api/legal/clients", {
      method: "PUT",
      body: JSON.stringify({ csvText, mode }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (mode === "preview") {
      setCsvPreview({
        totalValidRows: res.data?.totalValidRows ?? 0,
        inconsistencies: res.data?.inconsistencies ?? [],
      });
    } else {
      toast.success(
        `Importados ${res.data?.batch?.importedKeys.length ?? 0} registro(s); ${res.data?.batch?.duplicatesSkipped ?? 0} duplicata(s) ignorada(s).`,
      );
      setShowCsv(false);
      load();
    }
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Clientes e Partes (PF / PJ)"
        description="Cadastro unificado de clientes, representantes, contrapartes, testemunhas, peritos e advogados adversos, com isolamento por escritório e minimização LGPD."
        badge="Fase 1"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowCsv((v) => !v)}>
              <Upload className="mr-1.5 h-4 w-4" />
              Importar CSV Assistido
            </Button>
            <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Nova Pessoa / Parte
            </Button>
          </>
        }
      />

      {showCreate ? (
        <Card className="border-primary/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Novo Cadastro PF / PJ</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label>Nome completo / Razão social</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div>
                <Label>Tipo</Label>
                <select
                  value={personType}
                  onChange={(e) => setPersonType(e.target.value as "PF" | "PJ")}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="PF">Pessoa Física (PF)</option>
                  <option value="PJ">Pessoa Jurídica (PJ)</option>
                </select>
              </div>
              <div>
                <Label>CPF / CNPJ</Label>
                <Input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Somente dígitos ou formatado" />
              </div>
              <div>
                <Label>Telefone (WhatsApp)</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5548999990000" />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label>Grupo Econômico (para conflitos)</Label>
                <Input value={group} onChange={(e) => setGroup(e.target.value)} />
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" size="sm">Salvar</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {showCsv ? (
        <Card className="border-primary/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Importação CSV Assistida (Prévia + Deduplicação)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea rows={4} value={csvText} onChange={(e) => setCsvText(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => handleCsv("preview")}>
                Validar Prévia
              </Button>
              <Button size="sm" onClick={() => handleCsv("execute")}>
                Executar Importação Idempotente
              </Button>
            </div>
            {csvPreview ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
                <p>
                  Linhas válidas: <strong>{csvPreview.totalValidRows}</strong> · Inconsistências:{" "}
                  <strong>{csvPreview.inconsistencies.length}</strong>
                </p>
                {csvPreview.inconsistencies.map((inc) => (
                  <p key={inc.rowNumber} className="text-destructive">
                    Linha {inc.rowNumber}: {inc.reason}
                  </p>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, alias, CPF/CNPJ ou telefone..."
            className="pl-8"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">PF e PJ</option>
          <option value="PF">Somente PF</option>
          <option value="PJ">Somente PJ</option>
        </select>
      </div>

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : clients.length === 0 ? (
        <LegalEmptyState
          title="Nenhum cliente ou parte encontrado"
          description="Cadastre uma pessoa física ou jurídica ou importe via CSV."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {clients.map((c) => (
            <Card key={c.id} className="border-border bg-card">
              <CardContent className="space-y-2 pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{c.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Doc (mascarado LGPD): {c.cpf_cnpj_masked ?? "—"} · Tel: {c.phone ?? "—"}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <StatusPill label={c.person_type} tone="primary" />
                    {c.is_confidential ? <StatusPill label="Sigiloso" tone="danger" /> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {c.is_client ? "Cliente" : "Parte / Terceiro"}
                  </span>
                  {c.economic_group ? <span>· Grupo: {c.economic_group}</span> : null}
                  {c.authorized_channels?.length ? (
                    <span>· Canais autorizados: {c.authorized_channels.join(", ")}</span>
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
