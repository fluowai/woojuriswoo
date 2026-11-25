"use client";

import { useCallback, useSyncExternalStore } from "react";

const DEMO_USER_STORAGE_KEY = "woojuris.demo_user_id";

export interface DemoPersonaOption {
  id: string;
  label: string;
  roleLabel: string;
  officeLabel: string;
}

export const DEMO_PERSONAS: DemoPersonaOption[] = [
  {
    id: "user-socio-1",
    label: "Dra. Helena Vasconcelos",
    roleLabel: "Sócio / Admin",
    officeLabel: "Wootech SC",
  },
  {
    id: "user-coord-1",
    label: "Dr. Rafael Nogueira",
    roleLabel: "Coordenador",
    officeLabel: "Wootech SC",
  },
  {
    id: "user-adv-1",
    label: "Dra. Camila Medeiros",
    roleLabel: "Advogada (Grant Sigilo)",
    officeLabel: "Wootech SC",
  },
  {
    id: "user-assist-1",
    label: "Lucas Ferreira",
    roleLabel: "Assistente / Estagiário",
    officeLabel: "Wootech SC",
  },
  {
    id: "user-recep-1",
    label: "Marina Costa",
    roleLabel: "Recepção / Comercial",
    officeLabel: "Wootech SC",
  },
  {
    id: "user-fin-1",
    label: "Carlos Eduardo",
    roleLabel: "Financeiro",
    officeLabel: "Wootech SC",
  },
  {
    id: "user-auditor-1",
    label: "Patrícia Lemos",
    roleLabel: "Auditora",
    officeLabel: "Wootech SC",
  },
  {
    id: "user-ops-saas",
    label: "Operação SaaS",
    roleLabel: "Plataforma (Sem Pastas)",
    officeLabel: "Wootech SC",
  },
  {
    id: "user-beta-socio",
    label: "Dr. Henrique Campos",
    roleLabel: "Sócio / Admin",
    officeLabel: "Beta SP (Isolado)",
  },
];

export function getActiveDemoUserId(): string {
  if (typeof window === "undefined") return "user-socio-1";
  try {
    return localStorage.getItem(DEMO_USER_STORAGE_KEY) || "user-socio-1";
  } catch {
    return "user-socio-1";
  }
}

export function setActiveDemoUserId(userId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DEMO_USER_STORAGE_KEY, userId);
    window.dispatchEvent(new CustomEvent("woojuris:persona-changed", { detail: userId }));
  } catch {
    // ignore storage errors
  }
}

function subscribePersona(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("woojuris:persona-changed", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("woojuris:persona-changed", callback);
    window.removeEventListener("storage", callback);
  };
}

export function useDemoPersona() {
  const userId = useSyncExternalStore(
    subscribePersona,
    getActiveDemoUserId,
    () => "user-socio-1",
  );

  const changePersona = useCallback((nextId: string) => {
    setActiveDemoUserId(nextId);
  }, []);

  return { userId, changePersona };
}

export async function legalFetch<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("x-woojuris-demo-user", getActiveDemoUserId());

  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: json,
      error: json?.error || `Erro HTTP ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: json, error: null };
}

export function formatBrl(cents: number | null | undefined): string {
  const safe = Math.round(Number(cents) || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(safe / 100);
}

export function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return iso;
}
