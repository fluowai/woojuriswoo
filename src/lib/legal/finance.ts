// ============================================================
// WooJuris — Motor Financeiro Jurídico e Prestação de Contas
//
// - Todos os valores em inteiros de centavos (`cents: number` integer)
// - Arredondamento documentado: resto da divisão alocado na 1ª parcela
// - Geração idempotente de parcelas por contrato (nunca duplica)
// - Separação estrita: Receita Própria vs Valores de Terceiros/Clientes
// - Baixa parcial, estorno com trilha, desconto autorizado, êxito condicionado
// - Conciliação bancária com idempotência e prestação de contas
// ============================================================

import type {
  ClientFundAccount,
  Installment,
  LegalContract,
  LegalExpense,
  PaymentRecord,
  Receivable,
} from "./types";

export function formatBrlFromCents(cents: number): string {
  const safe = Math.round(Number(cents) || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe / 100);
}

/**
 * Divide valor inteiro em centavos em N parcelas exatas.
 * Política de arredondamento documentada:
 *   base = Math.floor(totalCents / count)
 *   remainder = totalCents - base * count
 *   A 1ª parcela absorve `remainder` centavos para que soma(parcelas) === totalCents.
 */
export function splitAmountIntoInstallments(
  totalCents: number,
  count: number,
): number[] {
  const safeTotal = Math.round(totalCents);
  const safeCount = Math.max(1, Math.floor(count));
  const base = Math.floor(safeTotal / safeCount);
  const remainder = safeTotal - base * safeCount;
  return Array.from({ length: safeCount }, (_, idx) =>
    idx === 0 ? base + remainder : base,
  );
}

function addMonthsIso(startIso: string, monthsToAdd: number): string {
  const [y, m, d] = startIso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + monthsToAdd, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * Gera conta a receber + parcelas de forma ESTRITAMENTE IDEMPOTENTE
 * para um contrato assinado. Reexecuções retornam o título já criado.
 */
export function generateReceivablesForContract(params: {
  contract: LegalContract;
  existingReceivables: Receivable[];
  officeFundAccountId: string;
  firstDueDate: string;
}):
  | { ok: true; receivable: Receivable; created: boolean }
  | { ok: false; error: string } {
  const { contract, existingReceivables, officeFundAccountId, firstDueDate } =
    params;

  if (contract.status !== "assinado") {
    return {
      ok: false,
      error: "Apenas contratos com status 'assinado' podem gerar títulos financeiros.",
    };
  }

  if (contract.fee_model === "exito" && !contract.success_condition_validated) {
    return {
      ok: false,
      error:
        "Honorários de êxito exigem validação expressa da condição contratual antes do faturamento.",
    };
  }

  const idempotencyKey = `contract:${contract.id}`;
  const already = existingReceivables.find(
    (r) =>
      r.account_id === contract.account_id &&
      r.idempotency_key === idempotencyKey,
  );
  if (already) {
    return { ok: true, receivable: already, created: false };
  }

  if (contract.total_value_cents <= 0) {
    return {
      ok: false,
      error: "Contrato não possui valor principal positivo para geração de parcelas.",
    };
  }

  const splits = splitAmountIntoInstallments(
    contract.total_value_cents,
    contract.installments_count,
  );
  const receivableId = `rec-${contract.id.slice(0, 8)}`;

  const installments: Installment[] = splits.map((amount, idx) => ({
    id: `${receivableId}-p${idx + 1}`,
    receivable_id: receivableId,
    installment_number: idx + 1,
    due_date: addMonthsIso(firstDueDate, idx),
    amount_cents: amount,
    paid_cents: 0,
    status: "aberto",
    billing_provider: "manual",
    nfse_status: "nao_emitida",
  }));

  const receivable: Receivable = {
    id: receivableId,
    account_id: contract.account_id,
    matter_id: contract.matter_id,
    contract_id: contract.id,
    fund_account_id: officeFundAccountId,
    revenue_class: "receita_propria",
    description: `Honorários — ${contract.title}`,
    total_cents: contract.total_value_cents,
    discount_cents: 0,
    paid_cents: 0,
    status: "aberto",
    competence_month: `${firstDueDate.slice(0, 7)}-01`,
    idempotency_key: idempotencyKey,
    installments,
  };

  return { ok: true, receivable, created: true };
}

/**
 * Registra baixa total ou parcial em uma parcela com proteção contra lançamento duplo (idempotencyKey).
 */
export function applyInstallmentPayment(params: {
  receivable: Receivable;
  installmentId: string;
  amountCents: number;
  method: PaymentRecord["payment_method"];
  idempotencyKey: string;
  existingPayments: PaymentRecord[];
  paidAt?: string;
}):
  | { ok: true; receivable: Receivable; payment: PaymentRecord; duplicate: boolean }
  | { ok: false; error: string } {
  const existing = params.existingPayments.find(
    (p) =>
      p.account_id === params.receivable.account_id &&
      p.idempotency_key === params.idempotencyKey,
  );
  if (existing) {
    return {
      ok: true,
      receivable: params.receivable,
      payment: existing,
      duplicate: true,
    };
  }

  const amount = Math.round(params.amountCents);
  if (amount <= 0) {
    return { ok: false, error: "Valor do pagamento deve ser maior que zero." };
  }

  const inst = params.receivable.installments.find(
    (i) => i.id === params.installmentId,
  );
  if (!inst) {
    return { ok: false, error: "Parcela não encontrada no título informado." };
  }
  if (inst.status === "cancelado" || inst.status === "pago") {
    return {
      ok: false,
      error: `Parcela em status "${inst.status}" não aceita nova baixa.`,
    };
  }

  const remaining = inst.amount_cents - inst.paid_cents;
  if (amount > remaining) {
    return {
      ok: false,
      error: `Valor informado (${formatBrlFromCents(amount)}) excede o saldo em aberto da parcela (${formatBrlFromCents(remaining)}).`,
    };
  }

  const updatedInstallments: Installment[] = params.receivable.installments.map(
    (i) => {
      if (i.id !== inst.id) return i;
      const nextPaid = i.paid_cents + amount;
      return {
        ...i,
        paid_cents: nextPaid,
        status: nextPaid >= i.amount_cents ? "pago" : "parcial",
      };
    },
  );

  const totalPaid = updatedInstallments.reduce((acc, i) => acc + i.paid_cents, 0);
  const netTotal = Math.max(
    0,
    params.receivable.total_cents - params.receivable.discount_cents,
  );

  const updatedReceivable: Receivable = {
    ...params.receivable,
    paid_cents: totalPaid,
    status: totalPaid >= netTotal ? "pago" : totalPaid > 0 ? "parcial" : "aberto",
    installments: updatedInstallments,
  };

  const payment: PaymentRecord = {
    id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    account_id: params.receivable.account_id,
    fund_account_id: params.receivable.fund_account_id,
    direction: "entrada",
    payment_method: params.method,
    amount_cents: amount,
    paid_at: params.paidAt ?? new Date().toISOString(),
    status: "confirmado",
    idempotency_key: params.idempotencyKey,
    reconciliation_status: "pendente",
    installment_id: inst.id,
  };

  return { ok: true, receivable: updatedReceivable, payment, duplicate: false };
}

/**
 * Estorna pagamento confirmado, recalculando saldo da parcela e do título com trilha.
 */
export function reverseInstallmentPayment(params: {
  receivable: Receivable;
  payment: PaymentRecord;
  reason: string;
}):
  | { ok: true; receivable: Receivable; payment: PaymentRecord }
  | { ok: false; error: string } {
  if (!params.reason || params.reason.trim().length < 5) {
    return { ok: false, error: "Estorno exige justificativa explícita." };
  }
  if (params.payment.status !== "confirmado") {
    return { ok: false, error: "Apenas pagamentos confirmados podem ser estornados." };
  }

  const updatedInstallments: Installment[] = params.receivable.installments.map(
    (i) => {
      if (i.id !== params.payment.installment_id) return i;
      const nextPaid = Math.max(0, i.paid_cents - params.payment.amount_cents);
      return {
        ...i,
        paid_cents: nextPaid,
        status: nextPaid === 0 ? "estornado" : "parcial",
      };
    },
  );

  const totalPaid = updatedInstallments.reduce((acc, i) => acc + i.paid_cents, 0);
  const updatedReceivable: Receivable = {
    ...params.receivable,
    paid_cents: totalPaid,
    status: totalPaid === 0 ? "estornado" : "parcial",
    installments: updatedInstallments,
  };

  const updatedPayment: PaymentRecord = {
    ...params.payment,
    status: "estornado",
    reconciliation_status: "divergente",
    reversal_reason: params.reason,
  };

  return { ok: true, receivable: updatedReceivable, payment: updatedPayment };
}

/**
 * Conciliação bancária por extrato (idempotente) associando linhas a pagamentos pendentes.
 */
export function reconcileBankStatementLines(
  payments: PaymentRecord[],
  statementLines: Array<{
    externalRef: string;
    date: string;
    amountCents: number;
    direction: "entrada" | "saida";
  }>,
): {
  matchedCount: number;
  unmatchedRefs: string[];
  updatedPayments: PaymentRecord[];
} {
  const updated = payments.map((p) => ({ ...p }));
  let matchedCount = 0;
  const unmatchedRefs: string[] = [];

  for (const line of statementLines) {
    const candidate = updated.find(
      (p) =>
        p.status === "confirmado" &&
        p.reconciliation_status !== "conciliado" &&
        p.direction === line.direction &&
        p.amount_cents === Math.round(line.amountCents),
    );
    if (candidate) {
      candidate.reconciliation_status = "conciliado";
      matchedCount++;
    } else {
      unmatchedRefs.push(line.externalRef);
    }
  }

  return { matchedCount, unmatchedRefs, updatedPayments: updated };
}

/**
 * Gera resumo contábil e prestação de contas separando rigorosamente
 * conta do escritório vs valores de terceiros/clientes.
 */
export function buildFinancialSummary(params: {
  fundAccounts: ClientFundAccount[];
  receivables: Receivable[];
  expenses: LegalExpense[];
}) {
  const officeOwnReceivedCents = params.receivables
    .filter((r) => r.revenue_class === "receita_propria" && r.status !== "cancelado")
    .reduce((sum, r) => sum + r.paid_cents, 0);

  const officeOwnReceivableCents = params.receivables
    .filter((r) => r.revenue_class === "receita_propria" && r.status !== "cancelado")
    .reduce((sum, r) => sum + Math.max(0, r.total_cents - r.discount_cents - r.paid_cents), 0);

  const thirdPartyFundsCents = params.fundAccounts
    .filter((a) => a.account_kind === "terceiros_clientes")
    .reduce((sum, a) => sum + a.balance_cents, 0);

  const officeFundsCents = params.fundAccounts
    .filter((a) => a.account_kind === "escritorio_propria")
    .reduce((sum, a) => sum + a.balance_cents, 0);

  const expensesTotalCents = params.expenses
    .filter((e) => e.status !== "cancelado" && e.status !== "estornado")
    .reduce((sum, e) => sum + e.amount_cents, 0);

  return {
    officeOwnReceivedCents,
    officeOwnReceivableCents,
    officeFundsCents,
    thirdPartyFundsCents,
    expensesTotalCents,
    netOfficeResultCents: officeOwnReceivedCents - expensesTotalCents,
  };
}
