# Runtime Apps

## What this folder is
Runtime services and user-facing applications for Auto-Organizer.

## What's inside
- `vps-control-api/`: control-plane API used by OpenClaw and local worker
- `local-daemon/`: Windows-first local executor, policy enforcement, scan/propose/execute/rollback
- `local-desktop/`: Tauri desktop app for local setup, approvals, execution, and rollback

## When to edit this folder
- You are changing runtime behavior, APIs, local worker policy, or desktop UX.

## What not to put here
- Shared cross-app types/utilities (`packages/`)
- Infra templates (`infra/`)
- Operational scripts (`scripts/`)

## Most important subfolders
- `local-daemon/src/server.ts`
- `local-daemon/src/poller.ts`
- `local-desktop/src/App.tsx`
- `vps-control-api/src/server.ts`
