type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
};

type ToolApi = {
  registerTool: (def: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (callId: string, params: Record<string, unknown>) => Promise<ToolResponse>;
  }) => void;
};

function jsonText(data: unknown): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getCfg() {
  const baseUrl = process.env.AO_CONTROL_API_URL || "http://127.0.0.1:4040";
  const serviceToken = process.env.AO_CONTROL_API_SERVICE_TOKEN || "";
  if (!serviceToken) {
    throw new Error("AO_CONTROL_API_SERVICE_TOKEN is missing");
  }
  return { baseUrl, serviceToken };
}

async function aoFetch(method: string, path: string, body?: unknown) {
  const { baseUrl, serviceToken } = getCfg();
  const headers: Record<string, string> = {
    "x-ao-service-token": serviceToken
  };
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const raw = await res.text();
  let parsed: unknown = raw;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = raw;
  }

  if (!res.ok) {
    throw new Error(`AO API ${method} ${path} failed: ${res.status} ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const next = value.filter((item): item is string => typeof item === "string");
  return next.length > 0 ? next : undefined;
}

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = asString(params[key]).trim();
  if (!value) {
    throw new Error(`Missing required parameter: ${key}`);
  }
  return value;
}

export default function register(api: ToolApi) {
  api.registerTool({
    name: "ao_list_devices",
    description: "List paired Auto-Organizer devices.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      return jsonText(await aoFetch("GET", "/v1/devices"));
    }
  });

  api.registerTool({
    name: "ao_get_device_status",
    description: "Get status for one Auto-Organizer device.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { deviceId: { type: "string" } },
      required: ["deviceId"]
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const deviceId = requiredString(params, "deviceId");
      return jsonText(await aoFetch("GET", `/v1/devices/${encodeURIComponent(deviceId)}/status`));
    }
  });

  api.registerTool({
    name: "ao_enqueue_cleanup_job",
    description: "Queue a cleanup run on a target device.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        deviceId: { type: "string" },
        dryRun: { type: "boolean" },
        pathKinds: {
          type: "array",
          items: { type: "string", enum: ["downloads", "desktop", "screenshots", "custom"] }
        },
        maxFiles: { type: "number" },
        allowedActions: {
          type: "array",
          items: { type: "string", enum: ["rename", "move", "archive", "duplicate_group", "index_only"] }
        },
        actorId: { type: "string" }
      },
      required: ["deviceId"]
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const deviceId = requiredString(params, "deviceId");
      const job = {
        jobId: newId("job"),
        deviceId,
        kind: "cleanup_run",
        triggerType: "manual",
        scope: {
          pathKinds: asStringArray(params.pathKinds) ?? ["custom"],
          maxFiles: asOptionalNumber(params.maxFiles) ?? 500,
          incremental: false
        },
        mode: {
          dryRun: asOptionalBoolean(params.dryRun) ?? true,
          allowedActions:
            asStringArray(params.allowedActions) ?? ["rename", "move", "archive", "index_only"]
        },
        requestedBy: {
          actorType: "openclaw",
          actorId: asString(params.actorId) || "openclaw"
        },
        createdAt: nowIso()
      };
      return jsonText(await aoFetch("POST", "/v1/jobs", job));
    }
  });

  api.registerTool({
    name: "ao_get_run_status",
    description: "Fetch run snapshot and progress.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { runId: { type: "string" } },
      required: ["runId"]
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const runId = requiredString(params, "runId");
      return jsonText(await aoFetch("GET", `/v1/runs/${encodeURIComponent(runId)}`));
    }
  });

  api.registerTool({
    name: "ao_get_run_summary",
    description: "Fetch compact run summary.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { runId: { type: "string" } },
      required: ["runId"]
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const runId = requiredString(params, "runId");
      return jsonText(await aoFetch("GET", `/v1/runs/${encodeURIComponent(runId)}/summary`));
    }
  });

  api.registerTool({
    name: "ao_list_run_proposals",
    description: "List proposals for a run.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { runId: { type: "string" } },
      required: ["runId"]
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const runId = requiredString(params, "runId");
      return jsonText(await aoFetch("GET", `/v1/runs/${encodeURIComponent(runId)}/proposals`));
    }
  });

  api.registerTool({
    name: "ao_submit_approvals",
    description: "Submit proposal approvals/rejections.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        runId: { type: "string" },
        actorId: { type: "string" },
        approvals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              proposalId: { type: "string" },
              decision: { type: "string", enum: ["approve", "reject"] },
              editedAfter: { type: "object" }
            },
            required: ["proposalId", "decision"]
          }
        }
      },
      required: ["runId", "approvals"]
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const runId = requiredString(params, "runId");
      const approvals = Array.isArray(params.approvals) ? params.approvals : [];
      if (approvals.length === 0) {
        throw new Error("Missing required parameter: approvals");
      }

      const payload = {
        runId,
        approvals,
        decidedBy: {
          actorType: "local_user",
          actorId: asString(params.actorId) || "openclaw-remote-approval"
        },
        decidedAt: nowIso()
      };

      return jsonText(await aoFetch("POST", `/v1/runs/${encodeURIComponent(runId)}/approvals`, payload));
    }
  });

  api.registerTool({
    name: "ao_request_execute",
    description: "Request execution of approved proposals.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { runId: { type: "string" } },
      required: ["runId"]
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const runId = requiredString(params, "runId");
      return jsonText(
        await aoFetch("POST", `/v1/runs/${encodeURIComponent(runId)}/execute`, {
          runId,
          executeApproved: true,
          requestedAt: nowIso()
        })
      );
    }
  });

  api.registerTool({
    name: "ao_request_rollback",
    description: "Request rollback for a run.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        runId: { type: "string" },
        executionIds: { type: "array", items: { type: "string" } }
      },
      required: ["runId"]
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const runId = requiredString(params, "runId");
      return jsonText(
        await aoFetch("POST", `/v1/runs/${encodeURIComponent(runId)}/rollback`, {
          runId,
          executionIds: asStringArray(params.executionIds),
          requestedAt: nowIso()
        })
      );
    }
  });

  api.registerTool({
    name: "ao_get_weekly_report",
    description: "Weekly report stub for scaffold builds.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        deviceId: { type: "string" },
        range: { type: "string", enum: ["last_7_days", "this_week"] }
      },
      required: ["deviceId"]
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const deviceId = requiredString(params, "deviceId");
      return jsonText({
        ok: false,
        code: "not_implemented",
        deviceId,
        range: asString(params.range) || "last_7_days",
        message: "Weekly report endpoint is not implemented in the scaffold yet."
      });
    }
  });
}
