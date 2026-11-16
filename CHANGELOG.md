# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
