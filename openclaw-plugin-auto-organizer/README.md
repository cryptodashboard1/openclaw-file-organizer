# OpenClaw Tool Plugin

## What this folder is
Native OpenClaw plugin that registers Auto-Organizer `ao_*` tools and forwards calls to the control API.

## What's inside
- `index.ts`: tool registration and API bridge logic
- `openclaw.plugin.json`: plugin manifest
- `package.json`: extension packaging metadata

## When to edit this folder
- You are changing tool definitions, request shaping, or plugin runtime behavior.

## What not to put here
- Skill command behavior (`openclaw-skill-auto-organizer/`)
- Control API server logic (`apps/vps-control-api/`)

## Most important files
- `index.ts`
- `openclaw.plugin.json`
- `package.json`

## Runtime env required
- `AO_CONTROL_API_URL` (default `http://127.0.0.1:4040`)
- `AO_CONTROL_API_SERVICE_TOKEN` (required)

## Registered tools
- `ao_list_devices`
- `ao_get_device_status`
- `ao_enqueue_cleanup_job`
- `ao_get_run_status`
- `ao_get_run_summary`
- `ao_list_run_proposals`
- `ao_submit_approvals`
- `ao_request_execute`
- `ao_request_rollback`
- `ao_get_weekly_report`
