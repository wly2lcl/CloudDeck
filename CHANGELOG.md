# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Mobile zh/en toggle with static label translations across login, projects, settings, project, and job screens.

## [0.1.15] - 2026-11-16

### Added

- Mobile settings can register an FCM/APNs device token with the control plane (`POST /v1/devices`). Token acquisition still requires an external Firebase/APNs SDK.

## [0.1.14] - 2026-11-16

### Changed

- Settings/admin form labels, table headers, and action buttons now follow the zh/en locale.

## [0.1.13] - 2026-11-16

### Added

- Control-plane model gateway `POST /v1/gateway/chat`: quota pre-check and OpenAI-compatible proxy (`GATEWAY_BASE_URL` / `GATEWAY_MODEL` / `GATEWAY_TOKEN`).

## [Unreleased]

### Changed

- Settings and admin page section headings now follow the zh/en locale.

## [0.1.12] - 2026-11-16

### Added

- Mobile settings screen: current user, tenants, quota usage, logout.
- Mobile content-chain summary (node/edge counts) on the project screen.

## [Unreleased]

### Added

- Worker-level model gateway: primary/fallback OpenAI-compatible providers, `LLM_FALLBACK_*` config, optional `LLM_MAX_COST_USD`.

## [Unreleased]

### Added

- Mobile content-chain DAG visualization with nodes and derived-from edges.

## [0.1.11] - 2026-11-16

### Added

- Mobile project screen now lists and posts project comments.

## [0.1.10] - 2026-11-16

### Added

- Web i18n provider with persisted zh/en toggle. Core navigation, login, projects, and job status strings are translated; settings/admin pages remain Chinese for now.

## [0.1.9] - 2026-11-16

### Added

- Project-level ACL: `project_members` table and `/v1/projects/:id/members` management. Projects stay tenant-wide until the first member is added, then only members plus owner/admin can access project, assets, jobs, comments, and shares.

## [0.1.8] - 2026-11-16

### Verified

- Backup/restore drill: Postgres `asset_versions` row count 1→1 and storage volume file count 1→1 after restore; drill environment cleaned up.

## [0.1.7] - 2026-11-16

### Added

- SMTP mail provider (`MAIL_PROVIDER=smtp` with `MAIL_SMTP_*`), alongside mock and HTTP gateway.
- Queue capacity baseline: 20 demo.echo jobs, p50 349ms, p95 569ms, 30s wall time on single-node compose.

## [0.1.6] - 2026-11-16

### Added

- Mailer abstraction with mock and HTTP providers; verification, password reset, and invitation emails are sent automatically.
- `/verify-email` web page.
- `MAIL_PROVIDER` / `MAIL_HTTP_URL` / `MAIL_HTTP_TOKEN` / `MAIL_FROM` configuration.

## [0.1.5] - 2026-11-16

### Added

- Platform admin APIs and `/admin` page: cross-tenant list, plan/quota overrides, global capability toggle, cross-tenant jobs.
- Email invitation flow: invite unregistered addresses, list pending invitations, accept via `/accept-invite`.
- `pnpm load:jobs` queue load script and `scripts/backup.sh` / `scripts/restore.sh`.

## [0.1.4] - 2026-11-16

### Added

- `novel.edit` chapter-level RAG-lite retrieval (explicit chapter, keyword overlap, recency) injected into the agent prompt.
- TTS chunks synthesize concurrently (`TTS_CONCURRENCY`, default 2) and are peak-normalized before concat.
- Video shots get deterministic fade-in/fade-out transitions.
- Webhook deliveries can be replayed manually (`POST /v1/webhook-deliveries/:id/replay`); stored payloads now include `jobId`.

### Changed

- Docs reflect the remaining gap between peak normalization/fades and true LUFS normalization/crossfades.

## [0.1.3] - 2026-11-16

### Added

- Web/mobile token auto-refresh on 401 with refresh-token rotation persistence.
- Tenant audit log writes (auth, members, API keys, credentials, capability toggles, shares, job cancel) and `GET /v1/audit-logs`.
- Member management (`GET/POST /v1/tenants/:id/members`, `PATCH/DELETE .../:userId`).
- Password reset, email verification, and scoped API keys with `x-api-key` authentication.
- Quota pre-deduction (`quota_usage.reserved_cost_usd`) to prevent concurrent oversubscription.
- Workspace TTL cleanup and `pnpm cleanup:storage` orphan-object cleanup.
- Payment webhooks verify signatures over the raw request body.
- Kubernetes manifests (`infra/k8s`) and Prometheus alerts (`infra/observability`).

### Changed

- Docs now mark rebased implementation gaps (RAG, loudness, transitions, model gateway) instead of describing them as shipped.

## [0.1.2] - 2026-11-15

### Added

- Coverage thresholds (75% lines / 45% branches) with optional Codecov upload and archived LCOV artifact.
- Playwright browser E2E: register → project → upload → run capability → artifact.
- Release smoke workflow: pull GHCR images for a published version and verify API/Web.
- GitHub Pages documentation site generated from `docs/` and the root README.
- Job outputs now expose asset names instead of internal step names.

## [0.1.1] - 2026-11-14

### Fixed

- Job and comment SSE streams now send CORS headers, so the web client can receive events cross-origin.
- Content graph scales to the panel width instead of clipping later pipeline stages.
- Runner no longer emits a duplicate `done` event after finalize.
- Job event list shows artifact names and no longer styles progress rows as bars.

### Changed

- Dependabot: `docker/build-push-action` v7, `docker/login-action` v4,
  `docker/metadata-action` v6, `docker/setup-buildx-action` v4, `cupertino_icons` 2.0.

## [0.1.0] - 2026-11-14

### Added

- Multi-tenant platform: accounts, tenants, projects, versioned assets, content links.
- Capability registry with manifests, permissions, budgets, and driver routing.
- Job queue (PostgreSQL `SKIP LOCKED`), runner, SSE events, cancellation, resume.
- Sandbox abstraction: local process and Docker (optional gVisor runtime).
- Drivers: mock, Claude Code (stream-json), OpenAI-compatible LLM, DashScope TTS, video (ffmpeg).
- Capabilities: `novel.edit`, `script.generate`, `storyboard.plan`, `audiobook.render`,
  `video.render`, `coding.assist`, `demo.echo`.
- Content chain: novel → script → storyboard → audiobook → video.
- Web client (Next.js) and Flutter mobile client.
- Commercial features: plans/quotas, usage ledger, reconciliation, invoice snapshots,
  capability toggles, templates and public template market, read-only shares, comments
  with SSE.
- Security: JWT auth with refresh rotation, AES-256-GCM credential storage and rotation,
  Helmet, rate limiting, webhook HMAC signatures.
- Observability: `/metrics` Prometheus endpoint and structured request logs.
- Tooling: pnpm monorepo, ESLint, TypeScript, Vitest (110 tests), Flutter analyze/test,
  dependency boundary checks, GitHub Actions CI, Dockerfiles and full-stack compose.
