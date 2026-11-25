"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, ExternalLink, Globe, Plus } from "lucide-react";
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
  LegalErrorState,
  LegalLoadingState,
  LegalPageHeader,
  StatusPill,
} from "@/components/legal/legal-ui";
import type { PortalInvitation, PortalPublication } from "@/lib/legal/types";

export default function PortalAdminPage() {
  const { userId } = useDemoPersona();
  const [invitations, setInvitations] = useState<PortalInvitation[]>([]);
  const [publications, setPublications] = useState<PortalPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const [pubTitle, setPubTitle] = useState("");
  const [pubBody, setPubBody] = useState("");
  const [sensitive, setSensitive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<{
      invitations: PortalInvitation[];
      publications: PortalPublication[];
    }>("/api/legal/portal");
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar portal", status: res.status });
    } else {
      setInvitations(res.data?.invitations ?? []);
      setPublications(res.data?.publications ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await legalFetch("/api/legal/portal", {
      method: "POST",
      body: JSON.stringify({
        kind: "publication",
        matterId: "mat-civel-01",
        publicationType: "andamento",
        title: pubTitle,
        body: pubBody,
        containsSensitiveInfo: sensitive,
        publishNow: true,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Andamento aprovado e publicado no Portal do Cliente.");
    setPubTitle("");
    setPubBody("");
    load();
  };

  const handleRevoke = async (
    action: "revoke_invitation" | "revoke_publication",
    id: string,
  ) => {
    const res = await legalFetch("/api/legal/portal", {
      method: "PATCH",
      body: JSON.stringify({ action, id }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Revogação aplicada imediatamente.");
    load();
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Portal do Cliente — Gestão de Convites & Publicações"
        description="O cliente acessa apenas itens publicados explicitamente e representações vigentes, com revogação imediata e trilha de aprovação."
        badge="Fase 4"
      />

      <Card className="border-primary/30 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-primary" />
            Publicar Andamento Autorizado ao Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePublish} className="grid gap-3">
            <div>
              <Label>Título da publicação</Label>
              <Input value={pubTitle} onChange={(e) => setPubTitle(e.target.value)} required />
            </div>
            <div>
              <Label>Texto visível ao cliente</Label>
              <Input value={pubBody} onChange={(e) => setPubBody(e.target.value)} required />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={sensitive}
                onChange={(e) => setSensitive(e.target.checked)}
              />
              <span>Contém informação sensível (exige aprovação de advogado/coordenador)</span>
            </label>
            <div>
              <Button type="submit" size="sm">Aprovar e Publicar no Portal</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Globe className="h-4 w-4 text-primary" />
                Convites &amp; Representações Vigentes ({invitations.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card-2 p-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-foreground">{inv.entity_name}</p>
                    <p className="text-muted-foreground">
                      Escopo: {inv.scope_role} · Expira em: {formatDateBr(inv.expires_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusPill
                      label={inv.is_revoked ? "Revogado" : "Ativo"}
                      tone={inv.is_revoked ? "danger" : "success"}
                    />
                    <Link href={`/portal-cliente/${inv.token}`} target="_blank">
                      <Button size="sm" variant="outline">
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        Abrir Portal
                      </Button>
                    </Link>
                    {!inv.is_revoked ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRevoke("revoke_invitation", inv.id)}
                      >
                        <Ban className="mr-1 h-3.5 w-3.5" />
                        Revogar
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Publicações no Portal ({publications.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {publications.map((pub) => (
                <div
                  key={pub.id}
                  className="space-y-1.5 rounded-lg border border-border bg-card-2 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{pub.title}</span>
                    <StatusPill
                      label={
                        pub.revoked_at
                          ? "Revogada"
                          : pub.published_at
                            ? "Publicada"
                            : "Rascunho (Oculta)"
                      }
                      tone={
                        pub.revoked_at
                          ? "danger"
                          : pub.published_at
                            ? "success"
                            : "neutral"
                      }
                    />
                  </div>
                  <p className="text-muted-foreground">{pub.body}</p>
                  {pub.published_at && !pub.revoked_at ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRevoke("revoke_publication", pub.id)}
                    >
                      Retirar do Portal
                    </Button>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
