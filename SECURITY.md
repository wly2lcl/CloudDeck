# Security Policy

## Supported versions

Security fixes are applied to the latest `main` and the most recent release tag.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub Security Advisories:

<https://github.com/wly2lcl/CloudDeck/security/advisories/new>

Include:

- Affected version or commit
- Reproduction steps or proof of concept
- Impact assessment (data exposure, privilege escalation, sandbox escape, etc.)

We aim to acknowledge reports within 3 business days and to provide a remediation
plan within 10 business days.

## Security model

- Multi-tenant isolation uses application-level filtering plus PostgreSQL RLS.
- Model credentials are encrypted with AES-256-GCM; plaintext is never returned by the API.
- Third-party agents run in isolated processes/containers. The local sandbox is a
  development convenience and is **not** a security boundary.
- Public share links are read-only, hashed at rest, expiring, and revocable.

## Known limitations

See [docs/limitations.md](docs/limitations.md) for provider, sandbox, and deployment
constraints that affect security decisions.
