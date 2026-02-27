# Deployment Templates

## What this folder is
Infrastructure templates used to deploy and run the control API on VPS environments.

## What's inside
- `systemd/`: service units
- `nginx/`: reverse proxy templates

## When to edit this folder
- You are changing service startup, restart behavior, or reverse-proxy routing.

## What not to put here
- Application runtime logic (`apps/`)
- Release automation scripts (`scripts/release/`)

## Most important subfolders
- `systemd/ao-control-api.service`
- `nginx/ao-control-api.conf`
