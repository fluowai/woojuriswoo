import { NextResponse } from "next/server";
import {
  applyInstallmentPayment,
  buildFinancialSummary,
  reconcileBankStatementLines,
  reverseInstallmentPayment,
} from "@/lib/legal/finance";
import { appendAuditEvent, getLegalStore } from "@/lib/legal/store";
import {
  legalErrorResponse,
  requireLegalPermission,
} from "@/lib/legal/server-context";
import type { LegalExpense, PaymentRecord } from "@/lib/legal/types";

export async function GET(request: Request) {
  try {
    const user = await requireLegalPermission(request, "finance", "read");
    const store = getLegalStore();
    const fundAccounts = store.fundAccounts.filter(
      (f) => f.account_id === user.accountId,
    );
    const receivables = store.receivables.filter(
      (r) => r.account_id === user.accountId,
    );
    const expenses = store.expenses.filter((e) => e.account_id === user.accountId);
    const payments = store.payments.filter((p) => p.account_id === user.accountId);
    const summary = buildFinancialSummary({ fundAccounts, receivables, expenses });

    return NextResponse.json({
      summary,
      fundAccounts,
      receivables,
      expenses,
      payments,
      billingAdapterMode: process.env.BILLING_API_KEY ? "producao" : "homologacao",
      nfseAdapterMode: process.env.NFSE_PROVIDER ? "producao" : "homologacao",
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireLegalPermission(request, "finance", "write");
    const body = (await request.json()) as
      | {
          action: "settle_installment";
          receivableId: string;
          installmentId: string;
          amountCents: number;
          method?: PaymentRecord["payment_method"];
          idempotencyKey?: string;
        }
      | {
          action: "create_expense";
          matterId?: string | null;
          fundAccountId: string;
          expenseKind: LegalExpense["expense_kind"];
          costCenter: string;
          description: string;
          amountCents: number;
          dueDate: string;
        }
      | {
          action: "reconcile_statement";
          lines: Array<{
            externalRef: string;
            date: string;
            amountCents: number;
            direction: "entrada" | "saida";
          }>;
        };

    const store = getLegalStore();

    if (body.action === "settle_installment") {
      const idx = store.receivables.findIndex(
        (r) => r.id === body.receivableId && r.account_id === user.accountId,
      );
      if (idx < 0) {
        return NextResponse.json({ error: "Título não encontrado." }, { status: 404 });
      }
      const res = applyInstallmentPayment({
        receivable: store.receivables[idx],
        installmentId: body.installmentId,
        amountCents: body.amountCents,
        method: body.method ?? "manual",
        idempotencyKey:
          body.idempotencyKey ??
          `settle:${body.installmentId}:${body.amountCents}:${Date.now()}`,
        existingPayments: store.payments,
      });
      if (!res.ok) {
        return NextResponse.json({ error: res.error }, { status: 400 });
      }
      store.receivables[idx] = res.receivable;
      if (!res.duplicate) {
        store.payments.unshift(res.payment);
        const fund = store.fundAccounts.find(
          (f) => f.id === res.payment.fund_account_id,
        );
        if (fund) fund.balance_cents += res.payment.amount_cents;
      }
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "finance.settle_installment",
        resource_type: "payment",
        resource_id: res.payment.id,
        outcome: "allowed",
        metadata: {
          amount_cents: res.payment.amount_cents,
          duplicate: res.duplicate,
        },
      });
      return NextResponse.json({
        receivable: res.receivable,
        payment: res.payment,
        duplicate: res.duplicate,
      });
    }

    if (body.action === "create_expense") {
      if (!body.description?.trim() || body.amountCents <= 0) {
        return NextResponse.json(
          { error: "Descrição e valor em centavos positivo são obrigatórios." },
          { status: 400 },
        );
      }
      const expense: LegalExpense = {
        id: `exp-${Date.now()}`,
        account_id: user.accountId,
        matter_id: body.matterId ?? null,
        fund_account_id: body.fundAccountId,
        expense_kind: body.expenseKind,
        cost_center: body.costCenter || "Geral",
        description: body.description.trim(),
        amount_cents: Math.round(body.amountCents),
        due_date: body.dueDate,
        status: "aberto",
      };
      store.expenses.unshift(expense);
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "finance.create_expense",
        resource_type: "expense",
        resource_id: expense.id,
        outcome: "allowed",
        metadata: { expense_kind: expense.expense_kind, amount_cents: expense.amount_cents },
      });
      return NextResponse.json({ expense }, { status: 201 });
    }

    if (body.action === "reconcile_statement") {
      const accountPayments = store.payments.filter(
        (p) => p.account_id === user.accountId,
      );
      const result = reconcileBankStatementLines(accountPayments, body.lines ?? []);
      // Persiste status conciliado
      for (const updated of result.updatedPayments) {
        const idx = store.payments.findIndex((p) => p.id === updated.id);
        if (idx >= 0) store.payments[idx] = updated;
      }
      appendAuditEvent({
        account_id: user.accountId,
        actor_user_id: user.userId,
        actor_role: user.legalRole,
        operation: "finance.reconcile_bank",
        resource_type: "reconciliation_run",
        outcome: "allowed",
        metadata: {
          matchedCount: result.matchedCount,
          unmatchedCount: result.unmatchedRefs.length,
        },
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Ação financeira inválida." }, { status: 400 });
  } catch (err) {
    return legalErrorResponse(err);
  }
}

// Estorno auditado de pagamento (exige permissão 'reverse')
export async function PATCH(request: Request) {
  try {
    const user = await requireLegalPermission(request, "finance", "reverse");
    const body = (await request.json()) as {
      paymentId: string;
      reason: string;
    };

    const store = getLegalStore();
    const pIdx = store.payments.findIndex(
      (p) => p.id === body.paymentId && p.account_id === user.accountId,
    );
    if (pIdx < 0) {
      return NextResponse.json({ error: "Pagamento não encontrado." }, { status: 404 });
    }
    const payment = store.payments[pIdx];
    const rIdx = store.receivables.findIndex(
      (r) =>
        r.account_id === user.accountId &&
        r.installments.some((i) => i.id === payment.installment_id),
    );
    if (rIdx < 0) {
      return NextResponse.json({ error: "Título associado não encontrado." }, { status: 404 });
    }

    const res = reverseInstallmentPayment({
      receivable: store.receivables[rIdx],
      payment,
      reason: body.reason,
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    store.receivables[rIdx] = res.receivable;
    store.payments[pIdx] = res.payment;
    const fund = store.fundAccounts.find((f) => f.id === payment.fund_account_id);
    if (fund) fund.balance_cents -= payment.amount_cents;

    appendAuditEvent({
      account_id: user.accountId,
      actor_user_id: user.userId,
      actor_role: user.legalRole,
      operation: "finance.reverse_payment",
      resource_type: "payment",
      resource_id: payment.id,
      outcome: "allowed",
      reason: body.reason,
      metadata: { amount_cents: payment.amount_cents },
    });

    return NextResponse.json({
      receivable: res.receivable,
      payment: res.payment,
    });
  } catch (err) {
    return legalErrorResponse(err);
  }
}
