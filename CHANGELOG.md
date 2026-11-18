# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.34] - 2026-11-18

### Added

- Retrieval evaluation expanded to 14 chapters / 8 cases with chapter recall, phrase recall, citation precision, chapter citation precision, and average citation count.
- Vector scoring adds keyword overlap to embedding similarity; top-10 chunk budget.

### Verified

- Lexical 100%/100%; vector 87.5% chapter recall / 75% phrase recall; citations locate specific lines.

## [0.1.33] - 2026-11-18

### Added

- Subtitle style presets (default/large/top bilingual/minimal) applicable to the active or all tracks.
- Snapping toggle for drag alignment.

## [0.1.32] - 2026-11-18

### Added

- Per-track subtitle style UI (font size, alignment, margin, outline) with per-track preview.
- Multi-track style JSON export for `video.render` `subtitleStyles`; driver parses JSON strings from the run form.

## [0.1.31] - 2026-11-18

### Added

- Paragraph-level vector retrieval with line-number citations in `citations.json`.
- Larger 8-chapter retrieval fixture and `pnpm eval:retrieval` lexical-vs-vector report (4/4 queries hit).

## [0.1.30] - 2026-11-18

### Added

- Subtitle editor: drag an entire cue to move it while preserving duration; boundaries snap to nearby cue edges (120ms) or a 10ms grid.

## [0.1.29] - 2026-11-18

### Added

- Capability run form selects assets per input and allows multiple subtitle tracks for `video.render`.

## [0.1.28] - 2026-11-18

### Added

- Simultaneous multi-track subtitle burn-in: each SRT input gets its own `subtitles` filter, defaulting to alternating bottom/top alignment; extra tracks are emitted as `subtitles-2..5` assets.

## [0.1.27] - 2026-11-18

### Added

- Subtitle editor supports multiple SRT tracks with visibility toggles and stacked preview.
- Drag waveform boundaries to adjust cue start/end.
- Merge visible tracks into a single `merged.srt` asset for video rendering.

## [0.1.26] - 2026-11-18

### Added

- Subtitle editor waveform: decode audio, draw peaks, click/Shift-click to set cue start/end.
- Live preview: video/audio playback with active cue overlay and style approximation.

## [0.1.25] - 2026-11-18

### Added

- Visual subtitle editor (`/projects/:id/subtitles`): edit cues, timing, text and style, save as SRT asset.
- Video render accepts an optional `subtitles` document input and burns it instead of generated SRT.

## [0.1.24] - 2026-11-18

### Added

- RAG citations: selected chapter titles are written to `citations.json` and collected as a separate `citations` asset; prompt tells the agent not to inline sources.

## [0.1.23] - 2026-11-18

### Added

- SiliconFlow embedding integration with fixed model `BAAI/bge-m3` via `SILICONFLOW_API_KEY`; runner forwards embedding env to the Claude Code driver.
- `pnpm smoke:embedding` for real embedding/RAG selection checks.

## [Unreleased]

### Verified

- SiliconFlow `BAAI/bge-m3` real embedding: 1024 dimensions; a 5-chapter fixture query selected the letter chapter plus neighbors.

## [0.1.22] - 2026-11-18

### Added

- Fixed LLM eval set (`evals/`) with automatic checks, heuristic baseline, per-case error handling, and `pnpm eval:llm`.
- Real-model eval attempted; provider returned 429 after retries, recorded as `model-error`.

## [0.1.21] - 2026-11-18

### Added

- Video transition selection (`fade`, `wipeleft/right`, `slideleft/right`, `circleopen`, `dissolve`).
- Subtitle `force_style` configuration (font, size, color, outline, alignment, margin); verified wipe + Chinese subtitle style in the runner image.

## [0.1.20] - 2026-11-17

### Added

- Video crossfade via ffmpeg `xfade` when available, with fade fallback.
- Subtitle burn-in via `subtitles`/libass when available; runner image installs Noto CJK fonts.
- `VIDEO_CROSSFADE` / `VIDEO_BURN_SUBTITLES` toggles.

## [Unreleased]

### Verified

- Runner image produces a 1.76s clip with xfade crossfade and burned-in Chinese subtitles.

## [0.1.19] - 2026-11-17

### Added

- Vector RAG for `novel.edit` when `EMBEDDING_HTTP_URL/MODEL` are configured, with lexical RAG-lite fallback.
- Tenant voice-profile library (`/v1/voice-profiles`) and `voiceProfileId` injection for audiobook jobs.
- Settings UI to manage voice profiles.

## [0.1.18] - 2026-11-17

### Added

- Audiobook final track uses ffmpeg `loudnorm` to target -16 LUFS, falling back to peak normalization when ffmpeg is unavailable.

## [0.1.17] - 2026-11-17

### Added

- Yjs collaborative draft persistence in `collab_docs` (restore on connect, write-back on updates).
- "Save as asset" action in the collaborative editor.
- Phase 3 production checklist in `docs/14-phase3-production.md`.

## [Unreleased]

### Added

- CycloneDX SBOM generation (`pnpm sbom`) archived by CI.
- Docker backup/restore scripts for compose Postgres + storage volume.
- Grafana production dashboard template.
- K8s manifest structural validation in `pnpm check`.

## [Unreleased]

### Added

- Short-lived gateway job tokens (`POST /v1/jobs/:id/gateway-token`, 5 minutes) accepted by `/v1/gateway/chat`.

## [Unreleased]

### Verified

- Audiobook media baseline: 5 fake-TTS jobs, p50 411ms, p95 455ms, 30s wall time on single-node compose.

## [Unreleased]

### Added

- Jobs issue a 30-minute gateway token at creation; runner injects `MODEL_GATEWAY_TOKEN` and the LLM worker calls the control-plane gateway.

## [0.1.16] - 2026-11-17

### Added

- Mobile zh/en toggle with static label translations across login, projects, settings, project, and job screens.

## [Unreleased]

### Added

- Yjs + y-websocket real-time collaborative draft at `/projects/:id/collab`, with project ACL on the WebSocket handshake.
- WebSocket sync integration test between two Yjs clients.

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
