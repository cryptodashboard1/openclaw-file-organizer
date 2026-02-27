/**
 * Example adapter showing how to wrap AO tools into a generic OpenClaw-style tool registry.
 *
 * This file is intentionally framework-agnostic because the exact OpenClaw registration
 * API depends on your VPS runtime version and plugin wiring.
 */

import { AO_TOOL_CATALOG, AoControlClient } from "../src/index.js";

type ToolInvocation = {
  name: string;
  input?: Record<string, unknown>;
};

type RegisteredTool = {
  name: string;
  description: string;
  execute: (input?: Record<string, unknown>) => Promise<unknown>;
};

export function buildAutoOrganizerToolSet(cfg: {
  controlApiUrl: string;
  serviceToken?: string;
}): RegisteredTool[] {
  const controlApi = new AoControlClient({
    baseUrl: cfg.controlApiUrl,
    serviceToken: cfg.serviceToken
  });

  const ctx = { controlApi };

  return [
    {
      name: "ao_list_devices",
      description: "List paired Auto-Organizer devices and their status.",
      execute: () => AO_TOOL_CATALOG.ao_list_devices(ctx)
    },
    {
      name: "ao_get_device_status",
      description: "Get status for one Auto-Organizer device.",
      execute: (input = {}) =>
        AO_TOOL_CATALOG.ao_get_device_status(ctx, input as { deviceId: string })
    },
    {
      name: "ao_enqueue_cleanup_job",
      description: "Queue a cleanup run on a target device.",
      execute: (input = {}) =>
        AO_TOOL_CATALOG.ao_enqueue_cleanup_job(
          ctx,
          input as {
            deviceId: string;
            dryRun?: boolean;
            pathKinds?: Array<"downloads" | "desktop" | "screenshots" | "custom">;
            maxFiles?: number;
          }
        )
    },
    {
      name: "ao_get_run_status",
      description: "Fetch run snapshot and progress events.",
      execute: (input = {}) => AO_TOOL_CATALOG.ao_get_run_status(ctx, input as { runId: string })
    },
    {
      name: "ao_get_run_summary",
      description: "Fetch compact run summary.",
      execute: (input = {}) =>
        AO_TOOL_CATALOG.ao_get_run_summary(ctx, input as { runId: string })
    },
    {
      name: "ao_list_run_proposals",
      description: "List proposals for a run.",
      execute: (input = {}) =>
        AO_TOOL_CATALOG.ao_list_run_proposals(ctx, input as { runId: string })
    },
    {
      name: "ao_request_execute",
      description: "Request execution of approved proposals.",
      execute: (input = {}) =>
        AO_TOOL_CATALOG.ao_request_execute(ctx, input as { runId: string })
    },
    {
      name: "ao_request_rollback",
      description: "Request rollback for a run.",
      execute: (input = {}) =>
        AO_TOOL_CATALOG.ao_request_rollback(
          ctx,
          input as { runId: string; executionIds?: string[] }
        )
    }
  ];
}

// Example generic dispatcher hook.
export async function dispatchAutoOrganizerTool(
  tools: RegisteredTool[],
  invocation: ToolInvocation
) {
  const tool = tools.find((t) => t.name === invocation.name);
  if (!tool) {
    throw new Error(`Unknown AO tool: ${invocation.name}`);
  }
  return tool.execute(invocation.input);
}
