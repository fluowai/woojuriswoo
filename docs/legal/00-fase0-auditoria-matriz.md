# Fase 0 — Diagnóstico do Repositório, Matriz de Reaproveitamento e Licenças

> **Base de referência:** `ArnasDon/wacrm` (Licença MIT preservada em [`LICENSE`](../../LICENSE)).
> **Marca padrão configurável:** `WooJuris` (identidade visual Wootech — fundo branco/claro com acento laranja, `pt-BR` por padrão, configurável via `NEXT_PUBLIC_BRAND_NAME`).

---

## 1. Inventário da cópia de trabalho

- **Origem verificada:** Diretório `wacrm-main` derivado do upstream `ArnasDon/wacrm`.
- **Versão em `package.json`:** `0.8.0` (`CHANGELOG.md` documenta até `0.8.1` — 2026-07-10).
- **Estado Git inicial:** Cópia extraída sem pasta `.git`; inicializada em repositório local com commit de baseline e branch de trabalho dedicada `feat/woojuris-legal-crm`.
- **Runtime / Ferramental:** Node `v22.17.1` (requisito `>=22.12.0`), Next.js `16.3.8`, React `19.2.4`, TypeScript `6`, Tailwind CSS `4`, Vitest `5.1.0`, Supabase SSR `0.12.7` / JS `2.119.0`, `next-intl` `4.14.9`.
- **Migrations existentes:** `001_initial_schema.sql` até `060_inbound_unsupported_reason.sql` (com `supabase/ci/verify-schema.sql`).
- **Diferença upstream vs fork:** Antes da Fase 1, a cópia corresponde 100% ao upstream `wacrm` v0.8.x sem customizações jurídicas prévias. Todas as extensões jurídicas são introduzidas de forma aditiva a partir da migration `061` e sob `src/lib/legal/`, `src/app/api/legal/`, `src/components/legal/` e rotas dedicadas no dashboard/portal.

---

## 2. Matriz Reutilizar / Adaptar / Criar

| Domínio / Componente | Decisão | Arquivos base / destino | Lacunas verificadas e riscos |
| --- | --- | --- | --- |
| **Multi-tenant (`accounts`, `profiles`, RLS)** | **Adaptar** | `supabase/migrations/017_account_sharing.sql`, `055_authz_membership_holes.sql`, `src/lib/auth/roles.ts`, `src/lib/auth/account.ts`, `src/hooks/use-auth.tsx` | Upstream possui apenas 4 papéis (`owner`, `admin`, `agent`, `viewer`) e um único nível de escopo (`account_id`). Faltam 9 perfis jurídicos, unidades/filiais, equipes, barreiras de sigilo (`is_restricted` + `matter_access_grants`) e acesso excepcional auditado (`break_glass_grants`). |
| **Autenticação / Login / MFA** | **Adaptar** | `src/app/(auth)/login/page.tsx`, `src/middleware.ts`, `src/components/settings/security-panel.tsx` | Upstream não exige/oferece desafio MFA TOTP no login nem separa escopo do Portal do Cliente. Middleware precisa proteger todas as novas rotas jurídicas e suportar sessão de portal revogável. |
| **Identidade Visual & i18n** | **Adaptar** | `src/app/globals.css`, `src/lib/themes.ts`, `src/app/layout.tsx`, `next.config.ts`, `src/i18n/request.ts`, `messages/pt.json` | Upstream inicia em `en` + modo `dark` + acento `violet`. Alterar padrão para `pt` (`pt-BR`), modo `light` (branco) e acento `wootech` (laranja), mantendo compatibilidade com testes de temas e i18n. |
| **Inbox WhatsApp Business API** | **Reutilizar + Adaptar** | `src/app/(dashboard)/inbox/page.tsx`, `src/app/api/whatsapp/webhook/route.ts`, `src/components/inbox/contact-sidebar.tsx` | Reutilizar integralmente webhook HMAC, mídia espelhada, dedup de contato/conversa (`022`, `036`, `040`). Adaptar para múltiplos números por escritório, vínculo com triagem/oportunidade/pasta, consentimento/canal autorizado e bloqueio padrão de disparos promocionais (Provimento OAB 205/2021). |
| **Contatos / Partes / Duplicatas / CSV** | **Adaptar** | `src/app/(dashboard)/contacts/page.tsx`, `src/lib/contacts/*`, nova rota `/clients` | Upstream modela apenas contatos simples. Criar `people_entities` (PF/PJ, CPF/CNPJ, OAB, aliases, grupo econômico, representantes) vinculável a `contacts`, com unificação revisável, números compartilhados e importação CSV assistida com prévia e rollback. |
| **Funil / Kanban / Oportunidades** | **Adaptar** | `src/app/(dashboard)/pipelines/page.tsx`, `src/components/pipelines/*`, `legal_intakes` | Adicionar campos de triagem jurídica (área, unidade, urgência, origem, SLA, expediente), agenda de consulta, checklist de entrada, status de conflito e conversão **idempotente** em pasta jurídica. |
| **Verificação de Conflitos** | **Criar** | `src/lib/legal/conflicts.ts`, `src/app/api/legal/conflicts/*`, `src/app/(dashboard)/conflicts/page.tsx` | Inexistente no upstream. Deve buscar por CPF/CNPJ/OAB/CNJ, nome normalizado e similaridade (trigram/Levenshtein + aliases + grupos econômicos + contrapartes), retornar sinal mínimo para sigilo, registrar decisão/justificativa/aprovador e bloquear contratação quando pendente. |
| **Pastas Jurídicas & Checklists Versionados** | **Criar** | `src/lib/legal/matters.ts`, `src/lib/legal/checklists.ts`, `src/app/(dashboard)/matters/*`, `src/app/api/legal/matters/*` | Inexistente no upstream. Separar pasta (`matters`) de cliente e processo, suportar extrajudicial/consultivo sem CNJ, sigilo restrito com precedência absoluta, transferência de responsável com reatribuição controlada e checklists por 9 áreas jurídicas. |
| **Processos & API Pública DataJud (CNJ)** | **Criar** | `src/lib/legal/cnj.ts`, `src/lib/legal/datajud.ts`, `src/app/(dashboard)/cases/page.tsx`, `src/app/api/legal/cases/*` | Inexistente no upstream. Normalização/validação CNJ 20 dígitos + DV (Res. CNJ 65/2008), catálogo oficial de aliases por tribunal (piloto TJSC, TRF4, TRT12), `Authorization: APIKey`, POST `/_search`, retry/backoff/Retry-After, deduplicação de movimentos por impressão estável, separação registro externo vs pasta interna, protocolos manuais com recibo. |
| **Central de Comunicações Oficiais** | **Criar** | `src/lib/legal/communications.ts`, `src/app/(dashboard)/communications/page.tsx`, `src/app/api/legal/communications/*` | Inexistente no upstream. Separar movimentação, publicação, intimação/citação, data de ciência e evento interno. Fila `nova → classificada → em revisão → vinculada/descartada`. Conectores DJEN/DJE/eproc/PJe/e-SAJ em homologação, sem ciência automática não autorizada. |
| **Prazos, Calendários Forenses e Tarefas** | **Criar** | `src/lib/legal/deadlines.ts`, `src/app/(dashboard)/deadlines/page.tsx`, `src/app/api/legal/deadlines/*` | Inexistente no upstream. Workflow `sugerido → em revisão → confirmado → cumprido/cancelado/recalculado`, regimes CPC (dias úteis) / Penal (dias corridos) / Trabalhista (CLT) / Administrativo, feriados/suspensões, revisão por 2ª pessoa, prazo interno vs legal, alerta sem duplicação. Nenhum movimento vira prazo confirmado automaticamente. |
| **Agenda (Audiências, Consultas, Diligências)** | **Criar** | `src/lib/legal/agenda.ts`, `src/app/(dashboard)/agenda/page.tsx`, `src/app/api/legal/agenda/*` | Inexistente no upstream. Audiência, reunião, sustentação, perícia, diligência, consulta presencial/remota, preparo, redesignação, ausência, exportação ICS com descrição mínima aprovada. |
| **Documentos, Quarentena, Modelos e OCR** | **Criar** | `src/lib/legal/documents.ts`, `src/app/(dashboard)/documents/page.tsx`, `src/app/api/legal/documents/*` | Upstream tem apenas `chat-media`/`flow-media`. Criar bucket privado `legal-documents` com isolamento por `account_id/matter_id`, hash SHA-256, quarentena de upload, versões, retenção, modelos DOCX/HTML versionados com campos tipados e adaptadores Gotenberg/OCRmyPDF em modo homologação. |
| **Contratos e Assinaturas** | **Criar** | `src/lib/legal/contracts.ts`, `src/app/(dashboard)/contracts/page.tsx`, `src/app/api/legal/contracts/*` | Inexistente no upstream. Fluxo `rascunho → revisão → aprovado → enviado → assinado/recusado/expirado`, aditivos, honorários (fixo, parcelado, recorrente, êxito), adaptador Documenso + webhook HMAC anti-replay + formalização manual com comprovante + disparo idempotente de títulos financeiros. |
| **Financeiro e Prestação de Contas** | **Criar** | `src/lib/legal/finance.ts`, `src/app/(dashboard)/finance/page.tsx`, `src/app/api/legal/finance/*` | Inexistente no upstream. Valores inteiros em centavos (`BIGINT`), separação conta do escritório vs conta de terceiros/clientes (`client_fund_accounts`), baixa parcial, estorno, cancelamento, desconto autorizado, êxito condicionado, conciliação bancária, prestação de contas com comprovantes, adaptadores PIX/Boleto/NFS-e em homologação, cobrança SaaS segregada. |
| **Portal do Cliente** | **Criar** | `src/lib/legal/portal.ts`, `src/app/(dashboard)/portal/page.tsx`, `src/app/portal-cliente/[token]/page.tsx`, `src/app/api/legal/portal/*` | Inexistente no upstream. Acesso apenas a `portal_publications` aprovadas e representações vigentes, revogação imediata, envio seguro de documentos e mensagens com auditoria. |
| **Relatórios, Importação CSV e Governança** | **Criar** | `src/lib/legal/reports.ts`, `src/lib/legal/csv-import.ts`, `src/app/(dashboard)/reports/page.tsx`, `src/app/(dashboard)/team/page.tsx` | Indicadores com fórmula/período/fuso/filtros explícitos, exportação assíncrona controlada por coluna com expiração, importação CSV assistida com rollback seguro, gestão de unidades/equipes/substituições e painel Hoje em `/dashboard`. |
| **IA Assistiva, Automações, API e MCP** | **Adaptar (Hardening)** | `src/lib/ai/*`, `src/lib/legal/ai-assistant.ts`, `src/app/(dashboard)/agents/page.tsx`, `src/app/api/v1/*`, `mcp-server/` | **Compliance jurídico:** desabilitar por padrão bot autônomo (`auto_reply_enabled = false`), campanhas/prospecção automática (`broadcasts` restrito por política OAB), MCP e chaves de API amplas até habilitação explícita por sócio/admin. IA assistiva sempre exige citações de fonte/versão e revisão humana antes de qualquer ação. |

---

## 3. Revisão de Licenças e Dependências Externas

| Componente / Repositório | Licença | Avaliação Jurídica / Técnica | Decisão Inicial |
| --- | --- | --- | --- |
| **WACRM** (`ArnasDon/wacrm`) | **MIT** | Permissiva; exige manutenção do aviso de copyright e licença original. | **Adotado como base.** `LICENSE` preservado integralmente. |
| **Dependências npm do WACRM** (Next.js, React, Supabase JS/SSR, Tailwind, shadcn/@base-ui, lucide, recharts, next-intl, Vitest) | MIT / ISC / Apache-2.0 / BSD | Compatíveis com uso comercial e distribuição SaaS. | **Aprovadas.** Nenhuma dependência GPL/AGPL adicionada ao monólito. |
| **Docxtemplater** (`open-xml-templating/docxtemplater`) | MIT (core) / Comercial (módulos pagos) | Core MIT permite substituição de placeholders; módulos avançados exigem licença comercial. | **Adaptador pronto + motor interno determinístico** para prévia/preenchimento sem módulos comerciais; integração de pacote externo mediante homologação de release. |
| **Gotenberg** (`gotenberg/gotenberg`) | MIT | Serviço HTTP containerizado privado para conversão DOCX/HTML → PDF. | **Adaptador HTTP isolado** em modo homologação até subir serviço privado (`GOTENBERG_URL`) + fallback HTML/print auditável. |
| **OCRmyPDF** (`ocrmypdf/OCRmyPDF`) | **MPL-2.0** (atenção a dependências distribuídas como Tesseract Apache-2.0 / Ghostscript AGPL) | Deve rodar exclusivamente como **worker/serviço isolado** fora do processo Next.js para evitar contaminação de licença e isolar processamento de arquivos em quarentena. | **Adaptador de fila isolado** (`OCR_WORKER_URL`) em modo homologação; preserva sempre o arquivo original intacto. |
| **Documenso** (`documenso/documenso`) | **AGPL-3.0** / Licença Comercial | Integração exclusivamente via API HTTP externa (contrato oficial + webhook HMAC), sem incorporar código-fonte no monólito. Avaliar requisitos jurídicos de assinatura eletrônica avançada/qualificada (Lei 14.063/2020 e MP 2.200-2/2001). | **Adaptador opcional em homologação** (`DOCUMENSO_API_URL`, `DOCUMENSO_API_KEY`, `DOCUMENSO_WEBHOOK_SECRET`) + **formalização manual auditável com comprovante** 100% funcional. |

---

## 4. Riscos Identificados e Mitigações

1. **Vazamento entre escritórios (multi-tenant) ou em pastas restritas (sigilo):**
   - *Mitigação:* `account_id` obrigatório + RLS em todas as tabelas + função `can_access_matter(matter_id)` com precedência absoluta para `is_restricted = true` (nega inclusive `partner_admin` sem grant explícito), replicada em camada TypeScript (`src/lib/legal/authz.ts`), storage (`legal-documents`) e exportações.
2. **Perda de prazo processual por automação indevida:**
   - *Mitigação:* Nenhum movimento do DataJud ou comunicação gera prazo confirmado automaticamente. Todos nascem `sugerido` ou `em_revisao`, exigindo validação humana e evidência.
3. **Captura judicial com efeito de ciência automática sem autorização:**
   - *Mitigação:* Conectores DJEN/DJE/eproc/PJe/e-SAJ bloqueiam captura com ciência automática por padrão (`allow_auto_acknowledgement = false`), exigindo política explícita e fluxo manual homologado.
4. **Duplicação de pastas ou lançamentos financeiros por cliques/webhooks repetidos:**
   - *Mitigação:* Chaves de idempotência (`idempotency_key`) e índices únicos em banco para conversão de oportunidade (`legal_intakes.converted_matter_id`), geração de parcelas por contrato (`fee_terms`/`receivables`), webhooks de assinatura (`inbox_events`) e conciliação bancária.
5. **Conflito com Provimento OAB 205/2021 (publicidade/captação ativa):**
   - *Mitigação:* Campanhas em massa, prospecção automática, auto-reply autônomo de IA e MCP vêm **desabilitados por padrão** no perfil jurídico do escritório (`office_governance_settings`).
