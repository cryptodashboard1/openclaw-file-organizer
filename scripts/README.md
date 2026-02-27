# Operational Tooling

## What this folder is
Operational scripts for install, verification, smoke tests, and release packaging.

## What's inside
- root scripts: OpenClaw plugin/skill install and verification, smoke runners
- `release/`: bundle build scripts, VPS installer, public URL reconfigure script, git-safe preflight

## When to edit this folder
- You need to change deployment steps, packaging flow, or operational verification.

## What not to put here
- Persistent app runtime code (`apps/`)
- Infra service templates (`infra/`)

## Most important subfolders
- `release/install-vps.sh`
- `release/build-vps-bundle.ps1`
- `release/build-all.ps1`
- `release/verify-git-safe.ps1`
