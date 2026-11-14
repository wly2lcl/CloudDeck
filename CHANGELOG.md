# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
