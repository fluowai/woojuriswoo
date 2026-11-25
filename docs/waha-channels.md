# Canais WAHA

A aba **Canais** cria sessões WAHA e exibe o QR Code. O webhook `/api/waha/webhook` identifica a conta pela sessão, cria ou reutiliza o contato e a conversa e grava a mensagem na inbox `/inbox` (Atendimentos).

Configure `WAHA_BASE_URL`, `WAHA_API_KEY` (se habilitado no WAHA) e `WAHA_WEBHOOK_SECRET`. Em desenvolvimento, mantenha o WAHA em uma porta diferente do Next, por exemplo `3001`. Para receber webhooks de um WAHA remoto, use um endpoint HTTPS/túnel apontando para `/api/waha/webhook`.

O processamento é idempotente por `(waha_instance_id, message_id)`, rejeita webhooks sem segredo e mantém o isolamento por `account_id`. A migration `067_waha_channels.sql` deve ser aplicada antes de criar a primeira instância.
