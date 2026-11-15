# Contributing to CloudDeck

Thanks for taking the time to contribute. CloudDeck is a TypeScript monorepo with a Flutter mobile client.

## Development setup

Requirements:

- Node.js >= 22 and pnpm 10
- Docker (for Postgres; tests use in-process PGlite and do not require Docker)
- Flutter 3.44+ (mobile only)

```sh
pnpm install
cp infra/compose/.env.example infra/compose/.env
docker compose -f infra/compose/docker-compose.yml up -d postgres
pnpm dev
```

Web runs at <http://localhost:3000>, the control plane at <http://localhost:4310>.

## Checks

```sh
pnpm lint             # ESLint
pnpm typecheck        # all workspaces + E2E TypeScript
pnpm test             # unit + contract + boundary tests
pnpm test:coverage    # same, with coverage thresholds
pnpm boundaries       # import boundary rules
pnpm check            # all of the above
```

Browser E2E requires the Docker stack:

```sh
docker compose -f infra/compose/docker-compose.yml up -d --build
pnpm exec playwright test
```

CI archives `coverage/lcov.info`; set the repository secret `CODECOV_TOKEN` to upload it to Codecov.

Mobile:

```sh
cd apps/mobile && flutter analyze && flutter test
```

## Repository rules

- `services/control-plane` must not import drivers, workers, or capabilities.
- Capability packages must not import each other; they communicate through assets.
- Platform code must not import engine internals; use process/HTTP/ACP boundaries.
- Keep contracts (`packages/contracts`) as the single source of truth for manifests, events, and assets.

These rules are enforced by `scripts/check-boundaries.ts` in CI.

## Adding a capability

1. Create `capabilities/<domain>.<action>/` with `capability.yaml`, `ui/form.json`, and a README.
2. Declare inputs, outputs, permissions, budget, and driver routing.
3. Add a driver or reuse an existing one (`agent-cli`, `acp`, `pipeline`, `llm`).
4. Add a contract test with a sample input.
5. Run `pnpm check`.

## Commits and pull requests

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`).
- Keep changes focused; update docs when behavior or contracts change.
- PRs must pass `check` and `mobile` CI jobs.
- For breaking contract changes, include a migration note and a version bump.

## Reporting security issues

Do not open a public issue. Use GitHub Security Advisories (see [SECURITY.md](SECURITY.md)).
