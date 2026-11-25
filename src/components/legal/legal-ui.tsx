"use client";

import type { ReactNode } from "react";
import { AlertCircle, Inbox, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LegalPageHeader({
  title,
  description,
  badge,
  actions,
}: {
  title: string;
  description: string;
  badge?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {badge ? (
            <Badge
              variant="secondary"
              className="border-primary/30 bg-primary/10 text-primary"
            >
              {badge}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function LegalLoadingState({ label = "Carregando dados jurídicos..." }: { label?: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>{label}</span>
      </CardContent>
    </Card>
  );
}

export function LegalErrorState({
  message,
  status,
  onRetry,
}: {
  message: string;
  status?: number;
  onRetry?: () => void;
}) {
  const isForbidden = status === 403;
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          {isForbidden ? (
            <ShieldAlert className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          {isForbidden ? "Acesso negado pelo controle de permissões/sigilo" : "Não foi possível carregar"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm text-foreground/80">
        <p>{message}</p>
        {onRetry ? (
          <div>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Tentar novamente
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function LegalEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="border-dashed border-border bg-card/60">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "primary";
}) {
  const styles: Record<typeof tone, string> = {
    neutral: "border-border bg-muted text-foreground",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    primary: "border-primary/30 bg-primary/10 text-primary",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[tone]}`}
    >
      {label}
    </span>
  );
}
