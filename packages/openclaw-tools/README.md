# `@ao/openclaw-tools`

Auto-Organizer control-plane tool wrappers for OpenClaw.

This package does not depend on OpenClaw internals directly. It provides:

- an HTTP client for the AO Control API (`AoControlClient`)
- tool functions (`ao_*`) that OpenClaw can register in its tool layer

## What to register

Tool catalog export:

- `AO_TOOL_CATALOG`

Key tools:

- `ao_list_devices`
- `ao_get_device_status`
- `ao_enqueue_cleanup_job`
- `ao_get_run_status`
- `ao_get_run_summary`
- `ao_list_run_proposals`
- `ao_submit_approvals`
- `ao_request_execute`
- `ao_request_rollback`

## Minimal integration pattern

```ts
import { AoControlClient, AO_TOOL_CATALOG } from "@ao/openclaw-tools";

const controlApi = new AoControlClient({
  baseUrl: process.env.AO_CONTROL_API_URL!,
  serviceToken: process.env.AO_CONTROL_API_SERVICE_TOKEN
});

const aoToolContext = { controlApi };

// Wrap/bridge these into your OpenClaw tool registration format.
// Example: "ao_list_devices" calls AO_TOOL_CATALOG.ao_list_devices(aoToolContext)
```

See `examples/register-ao-tools.example.ts` for a concrete adapter example.

## Integration rules (important)

- Register at the tool layer only (do not patch OpenClaw queue/dispatcher internals for v1)
- Return immediately after `ao_enqueue_cleanup_job` (do not block waiting for local approvals)
- Use follow-up turns to query status and summarize progress/results
