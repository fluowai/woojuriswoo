"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileText, Globe, ShieldAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { legalFetch, useDemoPersona } from "@/components/legal/legal-client";
import {
  LegalEmptyState,
  LegalErrorState,
  LegalLoadingState,
  LegalPageHeader,
  StatusPill,
} from "@/components/legal/legal-ui";
import type { LegalDocument, LegalDocumentTemplate } from "@/lib/legal/types";

export default function DocumentsPage() {
  const { userId } = useDemoPersona();
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [templates, setTemplates] = useState<LegalDocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [filename, setFilename] = useState("peticao-replica-v1.pdf");
  const [mimeType, setMimeType] = useState("application/pdf");

  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewSha, setPreviewSha] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await legalFetch<{
      documents: LegalDocument[];
      templates: LegalDocumentTemplate[];
    }>("/api/legal/documents");
    if (!res.ok) {
      setError({ message: res.error ?? "Erro ao carregar documentos", status: res.status });
    } else {
      setDocuments(res.data?.documents ?? []);
      setTemplates(res.data?.templates ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, userId]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await legalFetch("/api/legal/documents", {
      method: "POST",
      body: JSON.stringify({
        matter_id: "mat-civel-01",
        title: docTitle,
        filename,
        mime_type: mimeType,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Arquivo recebido em quarentena com hash SHA-256 calculado.");
    setDocTitle("");
    setShowUpload(false);
    load();
  };

  const handleDocAction = async (
    documentId: string,
    action: "approve_quarantine" | "publish_portal",
  ) => {
    const res = await legalFetch("/api/legal/documents", {
      method: "PATCH",
      body: JSON.stringify({ documentId, action }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      action === "approve_quarantine"
        ? "Documento liberado da quarentena."
        : "Documento aprovado e publicado no Portal do Cliente.",
    );
    load();
  };

  const handleRenderTemplate = async (tpl: LegalDocumentTemplate) => {
    const sampleValues: Record<string, string> = {
      cliente_nome: "Metalúrgica Atlântico Sul Ltda",
      cliente_documento: "41.222.333/0001-81",
      escopo: "Atuação contenciosa revisional bancária (1º e 2º graus TJSC)",
      valor_honorarios: "R$ 18.000,00",
      data_contrato: "2026-11-22",
      data_outorga: "2026-11-22",
    };
    const res = await legalFetch<{
      rendered: string;
      sha256: string;
      pdfAdapterMode: string;
    }>("/api/legal/documents", {
      method: "PATCH",
      body: JSON.stringify({
        action: "render_template",
        templateId: tpl.id,
        values: sampleValues,
      }),
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setPreviewText(res.data?.rendered ?? null);
    setPreviewSha(res.data?.sha256 ?? null);
    toast.success(
      `Prévia gerada (PDF Gotenberg em modo: ${res.data?.pdfAdapterMode}).`,
    );
  };

  return (
    <div className="space-y-4">
      <LegalPageHeader
        title="Documentos, Quarentena & Modelos Versionados"
        description="Preservação do arquivo original, quarentena de upload com hash SHA-256, OCR isolado (homologação) e modelos DOCX/PDF com campos tipados."
        badge="Fase 3"
        actions={
          <Button size="sm" onClick={() => setShowUpload((v) => !v)}>
            <Upload className="mr-1.5 h-4 w-4" />
            Enviar Documento (Quarentena)
          </Button>
        }
      />

      {showUpload ? (
        <Card className="border-primary/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Upload Seguro para Bucket Privado + Quarentena</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Título do Documento</Label>
                <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} required />
              </div>
              <div>
                <Label>Nome do Arquivo</Label>
                <Input value={filename} onChange={(e) => setFilename(e.target.value)} required />
              </div>
              <div>
                <Label>Tipo MIME</Label>
                <select
                  value={mimeType}
                  onChange={(e) => setMimeType(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  <option value="application/pdf">PDF (application/pdf)</option>
                  <option value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">
                    DOCX
                  </option>
                  <option value="image/png">Imagem PNG</option>
                  <option value="application/x-msdownload">Executável (Testar Bloqueio)</option>
                </select>
              </div>
              <div className="sm:col-span-3">
                <Button type="submit" size="sm">Validar &amp; Enviar p/ Quarentena</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <LegalLoadingState />
      ) : error ? (
        <LegalErrorState message={error.message} status={error.status} onRetry={load} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Repositório Documental Autorizado ({documents.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {documents.length === 0 ? (
                <LegalEmptyState
                  title="Nenhum documento acessível"
                  description="Apenas documentos de pastas autorizadas são exibidos."
                />
              ) : (
                documents.map((d) => (
                  <div
                    key={d.id}
                    className="space-y-2 rounded-lg border border-border bg-card-2 p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{d.title}</span>
                      <StatusPill
                        label={d.quarantine_status}
                        tone={d.quarantine_status === "aprovado" ? "success" : "warning"}
                      />
                    </div>
                    <p className="text-muted-foreground">
                      Original: {d.versions[0]?.filename} · SHA-256: {d.versions[0]?.sha256_hash.slice(0, 16)}… · OCR: {d.versions[0]?.ocr_status}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {d.quarantine_status === "quarentena" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDocAction(d.id, "approve_quarantine")}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                          Liberar Quarentena
                        </Button>
                      ) : !d.portal_published ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDocAction(d.id, "publish_portal")}
                        >
                          <Globe className="mr-1 h-3.5 w-3.5 text-primary" />
                          Publicar no Portal
                        </Button>
                      ) : (
                        <StatusPill label="Publicado no Portal" tone="primary" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-primary" />
                Modelos Versionados ({templates.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="space-y-2 rounded-lg border border-border bg-card-2 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{tpl.name}</span>
                    <StatusPill label={`v${tpl.current_version} · ${tpl.status}`} tone="primary" />
                  </div>
                  <p className="text-muted-foreground">
                    Campos tipados: {tpl.typed_fields.map((f) => f.key).join(", ")}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => handleRenderTemplate(tpl)}>
                    Gerar Prévia Validada (DOCX/PDF)
                  </Button>
                </div>
              ))}

              {previewText ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold text-primary">Prévia Renderizada (Gotenberg em Homologação)</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      SHA: {previewSha?.slice(0, 12)}
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-foreground">{previewText}</pre>
                </div>
              ) : null}

              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                <span>Gotenberg e OCRmyPDF operam em workers isolados; arquivos originais nunca são sobrescritos.</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
