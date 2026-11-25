"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Landmark, RotateCcw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatBrl,
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
import type {
  ClientFundAccount,
  LegalExpense,
  PaymentRecord,
  Receivable,
} from "@/lib/legal/types";

interface FinancePayload {
  summary: {
    officeOwnReceivedCents: number;
    officeOwnReceivableCents: number;
    officeFundsCents: number;
    thirdPartyFundsCents: number;
    expensesTotalCents: number;
    netOfficeResultCents: number;
  };
  fundAccounts: ClientFundAccount[];
  receivables: Receivable[];
  expenses: LegalExpense[];
  payments: PaymentRecord[];
  billingAdapterMode: string;
  nfseAdapterMode: string;
}

export default function FinancePage() {
  const { userId } = useDemoPersona();
  const [data, setData] = useState<FinancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<FinancePayload>("/api/legal/finance");
    if (!res.ok || !res.data) {
      setError({ message: res.error ?? "Erro ao carregar financeiro", status: res.status });
    } else {
      setData(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handleSettle = async (
    receivableId: string,
    installmentId: string,
    amountCents: number,
  ) => {
    const res = await legalFetch("/api/legal/finance", {
      method: "POST",
      body: JSON.stringify({
        action: "settle_installment",
        receivableId,
        installmentId,
        amountCents,
        method: "pix",
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Baixa de ${formatBrl(amountCents)} registrada com trilha.`);
    load();
  };

  const handleReverse = async (paymentId: string) => {
    const res = await legalFetch("/api/legal/finance", {
      method: "PATCH",
      body: JSON.stringify({
        paymentId,
        reason: "Estorno solicitado na conciliação bancária (comprovante divergente)",
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Pagamento estornado com recálculo de saldo e auditoria.");
    load();
  };

  const handleReconcileDemo = async () => {
    const pending = (data?.payments ?? []).find(
      (p) => p.status === "confirmado" && p.reconciliation_status === "pendente",
    );
    if (!pending) {
      toast.info("Não há pagamentos pendentes de conciliação no momento.");
      return;
    }
    const res = await legalFetch<{ matchedCount: number }>("/api/legal/finance", {
      method: "POST",
      body: JSON.stringify({
        action: "reconcile_statement",
        lines: [
          {
            externalRef: `OFX-${Date.now()}`,
            date: new Date().toISOString().slice(0, 10),
            amountCents: pending.amount_cents,
            direction: pending.direction,
          },
        ],
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Conciliação executada: ${res.data?.matchedCount ?? 0} lançamento(s) conciliado(s).`);
    load();
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Financeiro & Prestação de Contas"
        description="Valores exatos em centavos, separação rigorosa entre conta própria do escritório e valores de terceiros/clientes, baixa parcial, estorno, conciliação e prestação de contas."
        badge="Fase 4"
        actions={
          <Button size="sm" variant="outline" onClick={handleReconcileDemo}>
            <Landmark className="mr-1.5 h-4 w-4" />
            Conciliar Extrato Bancário
          </Button>
        }
      />

      {loading ? (
        <LegalLoadingState />
      ) : error || !data ? (
        <LegalErrorState
          message={error?.message ?? "Financeiro indisponível"}
          status={error?.status}
          onRetry={load}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border bg-card">
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">
                  Conta Própria do Escritório
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-foreground">
                  {formatBrl(data.summary.officeFundsCents)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Receita própria recebida: {formatBrl(data.summary.officeOwnReceivedCents)}
                </p>
              </CardContent>
            </Card>

            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-primary">
                  Conta de Terceiros / Clientes (Segregada)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-foreground">
                  {formatBrl(data.summary.thirdPartyFundsCents)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Nunca misturada à receita própria do escritório
                </p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">
                  Créditos a Receber (Em Aberto)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-foreground">
                  {formatBrl(data.summary.officeOwnReceivableCents)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  PIX/Boleto: {data.billingAdapterMode} · NFS-e: {data.nfseAdapterMode}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">
                  Despesas, Custas e Repasses
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-foreground">
                  {formatBrl(data.summary.expensesTotalCents)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Domínio SaaS separado do financeiro do escritório
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wallet className="h-4 w-4 text-primary" />
                Contas a Receber &amp; Parcelas ({data.receivables.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.receivables.map((rec) => (
                <div key={rec.id} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <p className="font-semibold text-foreground">{rec.description}</p>
                      <p className="text-muted-foreground">
                        Total: {formatBrl(rec.total_cents)} · Pago: {formatBrl(rec.paid_cents)} · Classe: {rec.revenue_class}
                      </p>
                    </div>
                    <StatusPill label={rec.status} tone={rec.status === "pago" ? "success" : "warning"} />
                  </div>
                  <div className="space-y-1.5">
                    {rec.installments.map((inst) => {
                      const remaining = inst.amount_cents - inst.paid_cents;
                      return (
                        <div
                          key={inst.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-card-2 px-3 py-1.5 text-xs"
                        >
                          <span>
                            Parcela #{inst.installment_number} · Venc.: {formatDateBr(inst.due_date)} ·{" "}
                            <strong>{formatBrl(inst.amount_cents)}</strong> (Pago: {formatBrl(inst.paid_cents)}) · NFS-e: {inst.nfse_status}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <StatusPill
                              label={inst.status}
                              tone={inst.status === "pago" ? "success" : "neutral"}
                            />
                            {remaining > 0 && inst.status !== "cancelado" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    handleSettle(rec.id, inst.id, Math.max(100, Math.floor(remaining / 2)))
                                  }
                                >
                                  Baixa Parcial (50%)
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleSettle(rec.id, inst.id, remaining)}
                                >
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                  Quitar
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pagamentos &amp; Conciliação ({data.payments.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card-2 px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-foreground">{formatBrl(p.amount_cents)}</span>{" "}
                    · {p.payment_method.toUpperCase()} · {formatDateBr(p.paid_at)} · Conciliação:{" "}
                    <strong>{p.reconciliation_status}</strong>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusPill
                      label={p.status}
                      tone={p.status === "confirmado" ? "success" : "danger"}
                    />
                    {p.status === "confirmado" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReverse(p.id)}
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        Estornar
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
