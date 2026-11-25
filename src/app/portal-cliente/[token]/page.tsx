"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FileText, Scale, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBrl, formatDateBr } from "@/components/legal/legal-client";
import { StatusPill } from "@/components/legal/legal-ui";

interface ClientPortalPayload {
  invitation: {
    entity_name: string;
    scope_role: string;
    expires_at: string;
  };
  matterSummary: {
    code: string;
    title: string;
    practice_area: string;
    status: string;
  } | null;
  publications: Array<{
    id: string;
    publication_type: string;
    title: string;
    body: string;
    published_at: string;
  }>;
  documents: Array<{ id: string; title: string; category: string }>;
  contracts: Array<{
    id: string;
    contract_number: string;
    title: string;
    status: string;
    total_value_cents: number;
  }>;
  receivables: Array<{
    id: string;
    description: string;
    total_cents: number;
    paid_cents: number;
    status: string;
  }>;
}

export default function ClientPortalPublicPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<ClientPortalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/legal/portal?token=${encodeURIComponent(params.token)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || "Acesso negado ou expirado.");
        } else {
          setData(json);
        }
      })
      .catch(() => setError("Não foi possível carregar o portal do cliente."));
  }, [params.token]);

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                {process.env.NEXT_PUBLIC_BRAND_NAME || "WooJuris"} — Portal do Cliente
              </h1>
              <p className="text-xs text-muted-foreground">
                Acesso seguro limitado às publicações e anexos explicitamente autorizados.
              </p>
            </div>
          </div>
          {data ? <StatusPill label={`Escopo: ${data.invitation.scope_role}`} tone="primary" /> : null}
        </header>

        {error ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <ShieldAlert className="h-5 w-5" />
                Acesso Indisponível ou Revogado
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-foreground/80">{error}</CardContent>
          </Card>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Validando convite autenticado...</p>
        ) : (
          <>
            <Card className="border-border bg-card">
              <CardContent className="pt-4 text-sm">
                <p className="font-semibold text-foreground">{data.invitation.entity_name}</p>
                {data.matterSummary ? (
                  <p className="text-xs text-muted-foreground">
                    Pasta {data.matterSummary.code} — {data.matterSummary.title} ({data.matterSummary.status})
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Linha de Andamentos Publicados</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.publications.map((p) => (
                  <div key={p.id} className="rounded-lg border border-border bg-card-2 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{p.title}</span>
                      <span className="text-muted-foreground">{formatDateBr(p.published_at)}</span>
                    </div>
                    <p className="mt-1 text-foreground/85">{p.body}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-border bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-primary" />
                    Documentos Autorizados ({data.documents.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {data.documents.map((d) => (
                    <div key={d.id} className="rounded border border-border px-3 py-2">
                      {d.title} ({d.category})
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-border bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Contratos &amp; Cobranças</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {data.contracts.map((c) => (
                    <div key={c.id} className="rounded border border-border px-3 py-2">
                      <p className="font-semibold">{c.contract_number} — {c.title}</p>
                      <p className="text-muted-foreground">{formatBrl(c.total_value_cents)} · {c.status}</p>
                    </div>
                  ))}
                  {data.receivables.map((r) => (
                    <div key={r.id} className="rounded border border-border px-3 py-2">
                      <p className="font-medium">{r.description}</p>
                      <p className="text-muted-foreground">
                        Pago: {formatBrl(r.paid_cents)} de {formatBrl(r.total_cents)} ({r.status})
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
