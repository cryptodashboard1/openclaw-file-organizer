# Auto-Organizer Agent

OpenClaw-orchestrated local file organizer with a Windows local executor, VPS control API, and plugin/skill integration.

## Repository map (name tags)

| Path | Name tag | What it contains | Who edits it |
| --- | --- | --- | --- |
| `apps/` | Runtime Apps | `vps-control-api`, `local-daemon`, `local-desktop` | App/dev engineers |
| `infra/` | Deployment Templates | Systemd + Nginx templates | DevOps/operators |
| `openclaw-plugin-auto-organizer/` | OpenClaw Tool Plugin | Native plugin that registers `ao_*` tools | OpenClaw integrators |
| `openclaw-skill-auto-organizer/` | OpenClaw Command Skill | One-command orchestration skill (`SKILL.md`) | OpenClaw integrators |
| `packages/` | Shared Libraries | Contracts, shared helpers, prompts, tool client package | App/dev engineers |
| `scripts/` | Operational Tooling | Install, verify, smoke, and release scripts | Operators/dev engineers |

Each folder has its own short `README.md` with usage boundaries.

## Minimal quickstart (dev)

```bash
pnpm install
```

Terminal 1:

```bash
set AO_CONTROL_API_SERVICE_TOKEN=dev-secret
pnpm dev:vps
```

Terminal 2:

```bash
set AO_CONTROL_API_URL=http://localhost:4040
set AO_CONTROL_API_SERVICE_TOKEN=dev-secret
pnpm dev:daemon
```

Terminal 3:

```bash
pnpm dev:desktop
```

Optional native shell:

```bash
pnpm dev:desktop:tauri
```

## Release/deploy flow (minimal)

Run safety preflight before commit/push:

```bash
pnpm verify:git-safe
```

Build artifacts only when needed:

```bash
pnpm release:vps
pnpm release:all
```

Use scripts in `scripts/release/` for VPS install and IP reconfiguration.

## Public-safe policy

This repo is source-only:
- do not commit generated artifacts (`.tgz`, `.exe`, checksums, bootstrap/token files)
- generate deploy artifacts on demand
- keep secrets and environment-specific values out of source

## Primary commands

- `pnpm dev:vps`
- `pnpm dev:daemon`
- `pnpm dev:desktop`
- `pnpm dev:desktop:tauri`
- `pnpm typecheck`
- `pnpm smoke:scaffold`
- `pnpm smoke:local-e2e`
