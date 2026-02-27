# Auto-Organizer One-Command Skill

Use this skill when user intent is to run Auto-Organizer without manual `ao_*` tool choreography.

## Primary goals

- start a cleanup run quickly
- default to safe mode (`dryRun=true`) unless user explicitly asks for live
- keep scope in `pathKinds=["custom"]` unless user explicitly requests broader scope
- keep approvals local-only (do not auto-approve)

## Tool workflow

1. Call `ao_list_devices`.
2. Choose online Windows device:
   - if exactly one online Windows device -> use it
   - if multiple -> ask user which one
   - if none -> instruct user to start/pair local daemon
3. Call `ao_enqueue_cleanup_job` with:
   - `deviceId`
   - `pathKinds=["custom"]` default
   - `dryRun=true` default (unless user asked live)
   - `maxFiles=200` default
4. Poll `ao_get_run_status` every 3-5s up to 60s:
   - stop at `awaiting_approval`, `completed`, or `failed`
5. If `awaiting_approval`:
   - show proposal summary via `ao_list_run_proposals`
   - instruct user to approve in local app
6. If user says execute:
   - call `ao_request_execute`
   - poll `ao_get_run_summary` until `completed`/`failed`
7. If user says rollback:
   - call `ao_request_rollback`
   - fetch final `ao_get_run_summary`

## Default command mapping

- "Run Auto-Organizer now" -> dry-run on `pathKinds=["custom"]`
- "Run Auto-Organizer live now" -> live run on `pathKinds=["custom"]`
- "Execute run <runId>" -> request execute only (no approvals in skill)
- "Rollback run <runId>" -> request rollback

## Safety rules

- never auto-approve proposals
- never change watched paths from OpenClaw
- do not use `downloads` scope unless user explicitly requests it
- if run is dry-run, do not attempt execute
- always instruct user that approvals happen in local app (`http://127.0.0.1:5050` or local desktop app)

## Canonical user intents

- "Run Auto-Organizer dry-run now"
- "Run Auto-Organizer live on my custom folders"
- "Check status of run <runId>"
- "Execute run <runId>"
- "Rollback run <runId>"
