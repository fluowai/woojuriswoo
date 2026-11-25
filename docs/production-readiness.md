# Production readiness

## Release gates

Run these commands from a clean checkout with Node.js `>=22.12.0`:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
(cd mcp-server && npm ci && npm run typecheck && npm run build && npm audit --audit-level=moderate)
```

The release is blocked if any command fails, if `npm audit` reports a critical/high vulnerability, or if the migration verification job fails.

## Required environment

Configure production values outside the repository:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY` (64 hexadecimal characters / 32 bytes)
- `META_APP_SECRET`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_APP_LOCALE`
- `NEXT_PUBLIC_BRAND_NAME`
- `AUTOMATION_CRON_SECRET` (required for scheduled automation/flow cron endpoints)

Never commit `.env.local`, service-role keys, Meta tokens, encryption keys or AI provider keys.

## Staging checklist

1. Apply all Supabase migrations to an empty staging project.
2. Run `supabase/ci/verify-schema.sql` against the resulting database.
3. Create two accounts and verify that contacts, conversations, media, legal records and audit events cannot cross account boundaries.
4. Configure a Meta test WABA and verify webhook challenge, inbound messages, outbound messages, delivery/read status, media and templates.
5. Verify team invitations, roles, ownership transfer and global sign-out.
6. Exercise broadcasts, automations, scheduled flows, retry behaviour and idempotency.
7. Exercise AI draft/autoreply limits and verify that provider keys remain server-side.
8. Verify upload size/type limits and private storage policies.
9. Capture error-rate, webhook-failure and job-lag alerts before launch.

## Operational requirements

- Use separate Supabase, Meta and domain credentials for development, staging and production.
- Keep daily database backups and test restoration before launch.
- Monitor application errors, webhook failures, message delivery failures, queue/cron lag and storage growth.
- Keep a rollback procedure for application releases and migrations.
- Record administrative actions in `audit_events` and define retention/deletion procedures for personal data.
