# Third-Party Notices

CloudDeck is MIT licensed. It depends on third-party software and can integrate
with third-party agents and model providers. This file summarizes important
licenses and constraints; it is not legal advice.

## Runtime dependencies (major)

| Component | License |
|---|---|
| Next.js, React, React DOM | MIT |
| Fastify, `@fastify/*` | MIT |
| Drizzle ORM | Apache-2.0 |
| `pg`, `zod`, `yaml`, `jose` | MIT / ISC |
| AWS SDK for JavaScript v3 | Apache-2.0 |
| Flutter / Dart packages | BSD-3-Clause, MIT (per package) |
| `just_audio`, `shared_preferences`, `http` | MIT / BSD |

## External engines

| Engine | License / terms | Notes |
|---|---|---|
| Claude Code | Proprietary; Anthropic commercial terms | The platform does not redistribute the CLI. Users must supply their own credentials and comply with Anthropic's terms. |
| OpenCode | MIT | Optional driver; not bundled. |
| DeepSeek Harness (`dsh`) | MIT | Optional driver; not bundled. |
| ffmpeg | LGPL-2.1+ / GPL-2.0+ depending on build | Invoked as an external binary; distribution of a build must comply with that build's license. |
| ComfyUI | GPL-3.0 | Not bundled; if integrated as a networked service, review GPL obligations. |

## Model and speech providers

- Alibaba Cloud Bailian / DashScope (`qwen-audio-3.1-tts-flash`) is called over HTTP.
  Users are responsible for their account, quota, content policy, and billing.
- Any OpenAI-compatible endpoint configured via `LLM_HTTP_URL` is governed by that
  provider's terms, including data retention and acceptable use.
- Voice cloning and audiobook generation require explicit consent from the voice
  owner and compliance with local law.

## Fonts and assets

The repository does not ship proprietary fonts. UI uses system font stacks.
