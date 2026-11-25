# Fase 0 — LGPD, Sigilo Profissional, Segurança, Operação e Deploy

## 1. Inventário de Dados, Bases Legais (LGPD) e Compliance OAB

| Categoria de Dado | Finalidade | Base Legal (Lei 13.709/2018) | Retenção / Guarda | Minimização / Exposição |
| --- | --- | --- | --- | --- |
| Leads / Triagem / Mensagens WhatsApp | Atendimento inicial e análise de viabilidade | Procedimentos preliminares a contrato (Art. 7º, V) / Legítimo interesse | 12 meses se arquivado sem contratação (respeitando hold) | Nunca logar corpo de mensagem ou telefone em telemetria |
| Dados de Clientes, Partes e CPF/CNPJ | Identificação, conflito de interesses, procuração e atuação | Execução de contrato (Art. 7º, V) e Exercício regular de direitos (Art. 7º, VI) | 5 anos após encerramento ou guarda legal/litigation hold | Mascarar CPF/CNPJ em listagens; nunca exibir em logs |
| Dados Sensíveis (saúde, trabalhista, criminal, previdenciário) | Defesa e atuação em processo judicial/administrativo | Exercício regular de direitos (Art. 11, II, "d") | Conforme prescrição/decadência + hold | Classificação `sigiloso`, acesso somente com grant explícito |
| Dados de Contrapartes / Testemunhas / Peritos | Análise de conflito e condução processual | Exercício regular de direitos (Art. 7º, VI) | Vinculado ao ciclo de vida da pasta | Em conflito sob sigilo, retornar apenas **sinal mínimo** |
| Documentos, Peças e Comprovantes | Repositório probatório e prestação de contas | Obrigação legal / Exercício regular de direitos | Conforme política da pasta + `retention_holds` | Bucket privado, quarentena de upload, links assinados expiráveis |
| Registros Financeiros / Notas / Repasses | Honorários, tributação e prestação de contas | Cumprimento de obrigação legal (Art. 7º, II) e Contrato | Mínimo 5 anos fiscais (CTN) | Conta do escritório segregada da conta de clientes |

### Provimento OAB 205/2021
- **Campanhas em massa / prospecção ativa:** desabilitadas por padrão (`accounts.broadcasts_enabled = false`).
- **Auto-reply autônomo de IA e MCP amplo:** desabilitados por padrão (`accounts.ai_autonomous_disabled = true`, `accounts.mcp_enabled = false`).
- **Comunicações e lembretes:** apenas informativos, mediante canal autorizado e finalidade registrada, sem mercantilização ou captação indevida.

### Direitos dos Titulares (DSAR) e Retenção
- Tabela `data_subject_requests` registra requerente, tipo (`acesso`, `correcao`, `anonimizacao`, `eliminacao`, `portabilidade`, `revogacao`), verificação de identidade, análise de impacto em terceiros/sigilo profissional, justificativa e prazo legal (15 dias).
- `retention_holds` impede exclusão ou anonimização enquanto houver litígio ativo, prazo prescricional ou obrigação legal/fiscal.

---

## 2. Controles de Segurança

- **MFA obrigatório por perfil:** sócio/administrador, coordenador, advogado, financeiro e auditor (`profiles.mfa_required = true`), com fluxo TOTP no login (`/login`) e painel de segurança (`/settings?tab=security`).
- **Segredos rotacionáveis:** chaves externas (`DATAJUD_API_KEY`, `DOCUMENSO_WEBHOOK_SECRET`, `META_APP_SECRET`, `ENCRYPTION_KEY`) exclusivamente no servidor; nunca expostas em `NEXT_PUBLIC_*`.
- **Webhooks seguros:** verificação HMAC-SHA256 + proteção contra replay via `inbox_events (account_id, provider, external_event_id)` com unicidade.
- **Trilha de auditoria imutável:** tabela `audit_events` com trigger bloqueando `UPDATE`/`DELETE` por usuários comuns (`authenticated`).
- **Zero vazamento em logs:** helper central `redactSensitiveForLog` mascara CPF, CNPJ, tokens, chaves de API, telefones e conteúdos jurídicos antes de qualquer `console.error`/`console.warn`.

---

## 3. Guia de Uso por Perfil

1. **Sócio/Administrador (`partner_admin`):** acessa `/settings`, `/team`, `/reports`, `/conflicts` (aprovação), `/finance`, `/matters` (exceto pastas restritas sem grant explícito). Configura marca, timezone, compliance OAB, unidades e equipes.
2. **Coordenador/Controller (`coordinator`):** acompanha `/dashboard` (Hoje), `/communications` (fila oficial), `/deadlines` (revisão em 2ª pessoa e escalonamento), `/agenda`, `/cases` e distribuição em `/matters`.
3. **Advogado (`lawyer`):** opera pastas autorizadas em `/matters/[id]`, consulta DataJud em `/cases`, valida prazos em `/deadlines`, elabora/aprova documentos e contratos em `/documents` e `/contracts`, publica andamentos no `/portal`.
4. **Assistente/Estagiário (`assistant`):** executa tarefas, checklists, minutas e organização documental nas pastas autorizadas; não pode aprovar versão final, publicar andamento sensível nem confirmar prazo sem permissão.
5. **Recepção/Comercial (`reception`):** opera `/inbox`, `/pipelines`, agenda de consultas, cadastro inicial em `/clients` e solicita verificação de conflitos em `/conflicts`.
6. **Financeiro (`finance`):** gerencia `/finance` (honorários, parcelas, baixas, estornos, conciliação e prestação de contas) vendo apenas referência mínima da pasta (código, título e cliente).
7. **Cliente/Representante (`client`):** acessa `/portal-cliente/[token]` com escopo restrito às publicações autorizadas e representações vigentes.
8. **Auditor Autorizado (`auditor`):** consulta registros delimitados pelo mandato e gera exportações auditadas em `/reports`.
9. **Operação SaaS (`platform_ops`):** monitora planos, consumo e saúde da plataforma; acesso a dados jurídicos exige `break_glass_grants` temporário com motivo e autorizador.

---

## 4. Guia de Deploy, Rollback e Renovação de Credenciais

### 4.1 Variáveis de Ambiente (sem segredos)
Consulte [`.env.local.example`](../../.env.local.example) — todas as novas variáveis jurídicas possuem padrão seguro (`NEXT_PUBLIC_APP_LOCALE=pt`, `NEXT_PUBLIC_BRAND_NAME=WooJuris`, `DATAJUD_TIMEOUT_MS=15000`, `DATAJUD_MAX_CONCURRENCY=2`, `JUDICIAL_CONNECTORS_ENABLED=false`).

### 4.2 Sequência de Deploy (Docker / Portainer / Swarm / Hostinger)
1. **Backup pré-deploy:** `pg_dump --format=custom` do Postgres Supabase + validação de checksum e teste periódico de restore em ambiente de homologação.
2. **Migrations:** aplicar `061` até `066` em ordem crescente (todas idempotentes: `IF NOT EXISTS` / `DROP POLICY IF EXISTS`) e executar `supabase/ci/verify-schema.sql`.
3. **Validação de rede e secrets (Portainer/Swarm):**
   - Secrets externos montados somente no serviço `app` e `worker`, nunca em variáveis build-time.
   - Rede interna isolada (`woojuris_internal`) para Gotenberg e OCRmyPDF (sem exposição pública).
   - Healthcheck HTTP `/api/legal/health` com verificação de conexão e estado das integrações.
4. **Build e Rollout:** `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.
5. **Rollback seguro:**
   - Aplicação: reverter tag da imagem Docker / deploy anterior (as migrations `061`–`066` são puramente aditivas — compatíveis com a versão anterior do WACRM!).
   - Banco: nunca executar `DROP TABLE` em produção; desativar feature flags ou restaurar snapshot validado se necessário.

### 4.3 Metas de RPO / RTO e Resposta a Incidentes
- **RPO alvo:** `<= 15 minutos` (PITR / WAL archiving Supabase + backups diários verificados).
- **RTO alvo:** `<= 60 minutos` para restauração completa de aplicação + banco + storage.
- **Incidente de segurança / vazamento:** (1) revogar sessões/tokens afetados, (2) congelar `api_keys` e convites de portal, (3) preservar `audit_events`, (4) avaliar comunicação à ANPD e titulares conforme Art. 48 da LGPD.

### 4.4 Procedimento de Renovação de Credenciais
- **DataJud (`DATAJUD_API_KEY`):** atualizar variável de ambiente no servidor/secret manager, reiniciar container/serviço e testar `POST /api/legal/cases/datajud-search` com processo público piloto. Falha `401/403` marca a conexão em `auth_error` sem perder dados já sincronizados.
- **Meta WhatsApp (`META_APP_SECRET`):** suporta lista separada por vírgula durante janela de rotação zero-downtime.
- **Documenso (`DOCUMENSO_API_KEY`, `DOCUMENSO_WEBHOOK_SECRET`):** rotacionar no provedor e atualizar secret; webhooks rejeitados ficam auditados.
- **`ENCRYPTION_KEY`:** exige rotina controlada de re-criptografia das colunas cifradas em AES-256-GCM antes de descartar a chave anterior.

---

## 5. Matriz de Funcionalidades Homologadas por Origem (Piloto)

| Origem / Canal | Capacidade Atual | Status | Observação |
| --- | --- | --- | --- |
| **WhatsApp Business API (Meta)** | Recepção, triagem, mídia, vínculo com oportunidade/pasta | **Operacional** (requer credenciais Meta) | Campanhas/prospecção bloqueadas por padrão (OAB) |
| **Entrada Manual / Formulário / E-mail** | Atendimento, conflitos, pastas, processos, comunicações, prazos, documentos, contratos, financeiro | **Operacional** | Fluxo completo sem dependência externa |
| **DataJud CNJ — TJSC** | Busca de capa/movimentos públicos, validação CNJ, deduplicação | **Homologação / Piloto** | Fixtures oficiais sintéticas + client HTTP pronto para `DATAJUD_API_KEY` |
| **DataJud CNJ — TRF4** | Busca de capa/movimentos públicos, múltiplos graus/instâncias | **Homologação / Piloto** | Fixtures oficiais sintéticas + client HTTP pronto para `DATAJUD_API_KEY` |
| **DataJud CNJ — TRT12** | Avaliação trabalhista + contagem CLT | **Homologação / Piloto** | Fixtures sintéticas + adaptador de alias `api_publica_trt12` |
| **DJEN / Domicílio Judicial Eletrônico** | Inbox manual, upload de arquivo/recorte e link oficial | **Homologação (Manual)** | Captura automática com ciência bloqueada até homologação |
| **eproc / PJe / e-SAJ** | Cadastro manual + protocolo manual com recibo | **Homologação (Manual)** | Requer certificado/credenciamento específico por tribunal |
| **Gotenberg / OCRmyPDF / Documenso** | Adaptadores de contrato oficial + fallback manual auditável | **Homologação** | Ativáveis via env vars dedicadas em containers isolados |
| **PIX / Boleto / NFS-e** | Adaptador + registro manual, baixa parcial, estorno e conciliação | **Homologação** | Ativáveis após homologação do provedor e código municipal |
