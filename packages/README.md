# Shared Libraries

## What this folder is
Reusable packages shared across apps, plugin, and scripts.

## What's inside
- `contracts/`: shared API/request/response/domain types
- `common/`: shared helpers (IDs, time, result utilities)
- `openclaw-tools/`: client + tool definitions for `ao_*` calls
- `prompts/`: prompt specifications used by planning flows

## When to edit this folder
- You need shared logic or shared contracts used by multiple components.

## What not to put here
- App-specific endpoint logic (`apps/`)
- VPS install scripts (`scripts/`)

## Most important subfolders
- `contracts/src/index.ts`
- `openclaw-tools/src/tool-definitions.ts`
- `common/src/`
- `prompts/`
