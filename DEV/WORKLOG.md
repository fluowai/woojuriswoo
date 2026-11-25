# WooJuris / wacrm — Worklog

## 2026-11-25 — hierarquia SaaS multi-nível

- Evoluída a matriz de papéis para `Mega Super Admin` (`platform_ops`), `Super Admin / Revenda White Label` (`reseller_admin`), `Admin / Sócio do Escritório` (`partner_admin`), Advogado, Secretaria/Estagiário, Atendimento e Financeiro.
- Adicionada migration `069_saas_role_hierarchy.sql` com os novos papéis sem alterar o isolamento multi-tenant existente; a numeração 068 já era usada pelo banco remoto.
- Sessão agora carrega `profiles.legal_role`; a sidebar identifica o nível atual e exibe uma área de plataforma para operação SaaS e revendas.
- Mantidos os módulos jurídicos existentes no menu: inbox/atendimento, clientes, conflitos, pastas, processos, prazos, agenda, documentos, contratos, financeiro, portal, relatórios, equipe, canais e automações.
- Verificação direcionada: domínio jurídico 13/13 testes passou; `git diff --check` sem erros de whitespace. Typecheck/lint completos excederam 60s no ambiente e ficaram pendentes.

## 2026-11-25 — catálogo de agentes jurídicos

- Evoluída a aba `/agents` para um catálogo de agentes autônomos de atendimento jurídico.
- Adicionadas 12 áreas e subnichos prontos para triagem: Civil, Criminal, Previdenciário, Tributário, Trabalhista, Empresarial, Imobiliário, Administrativo, Consumidor, Família e Sucessões, Ambiental e Digital/Dados.
- Incluídos busca por área/subnicho, filtro de agentes ativos, seleção de área, ativação/desativação e ações de teste/configuração.
- Mantidos o playground, a configuração e os indicadores de uso de IA existentes.

## 2026-11-25 — production-readiness pass

- Confirmed the existing product surface: Next.js + Supabase + Meta WhatsApp Cloud API, with CRM, inbox, broadcasts, automations, flows and legal operations modules.
- Fixed deterministic, application-locale-aware currency formatting so the host locale does not change deal summaries or tests.
- Optimized the ICU safety test to reuse the translator instead of constructing one for every catalogue key.
- Revalidated the affected tests: 15/15 passed.
- Updated Next.js to 16.4.6 and eslint-config-next to the matching version in `package.json` and `package-lock.json`.
- Removed the unused `shadcn` runtime dependency and removed its obsolete CSS import.
- `npm audit` now reports zero vulnerabilities at info/low/moderate/high/critical levels from the current lockfile.

## Remaining verification

- The root TypeScript project now excludes the independently packaged `mcp-server`; CI has a dedicated MCP job.
- Full lint, typecheck, test and production build must be rerun after a clean dependency install.
- Live Supabase/Meta integration, RLS isolation, webhook delivery and E2E browser flows require configured staging credentials and cannot be proven from static local analysis alone.

## Final local verification

- Root lint: passed with warnings only.
- Root typecheck: passed.
- Root tests: 162 files / 1,759 tests passed.
- Production build: passed; 80 static pages generated.
- MCP typecheck and build: passed.
- Root and MCP dependency audits: 0 vulnerabilities.
- Local server: `http://127.0.0.1:3000` responded with HTTP 200 for login, signup, dashboard, inbox, contacts, matters and reports.
- Cron authentication: invalid secret correctly returned HTTP 401.

## 2026-11-25 — Canais WAHA

- Implementada a migration `067_waha_channels.sql` com instâncias por conta, RLS, vínculo com conversas/mensagens e idempotência por mensagem WAHA.
- Criada a aba `/channels`, criação de sessões, status, QR Code, desconexão e exclusão.
- Criado webhook `/api/waha/webhook` com segredo, roteamento de mensagens para a inbox e criação automática de contatos/conversas.
- Respostas de texto da inbox passam a usar WAHA quando a conversa estiver vinculada a uma instância WAHA; Meta permanece inalterado para conversas oficiais.
- Documentação em `docs/waha-channels.md` e variáveis WAHA no `.env.local.example`.
- Verificação local: `/channels` e `/inbox` responderam 200; APIs protegidas rejeitaram requisições sem autenticação; typecheck/build passaram. O teste real de QR/webhook depende de WAHA configurado e da aplicação da migration no Supabase.
