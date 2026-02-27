import type {
  BootstrapStatus,
  DaemonStatus,
  LocalSettings,
  MetricsOverview,
  RuntimeStatus,
  RunDetails,
  RunRecord,
  WatchedPath
} from "./types";

const BASE_URL = "http://127.0.0.1:5050";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const raw = await response.text();
  const json = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(json?.message ?? json?.error ?? `${response.status} ${response.statusText}`);
  }
  return json as T;
}

export const daemonApi = {
  getStatus: () => requestJson<DaemonStatus>("/api/status"),
  getDevice: () => requestJson<{ paired: boolean; deviceId?: string; lastHeartbeatAt?: string }>("/api/device"),
  getRuntimeStatus: () => requestJson<RuntimeStatus>("/api/runtime/status"),
  startRuntime: () =>
    requestJson<{ ok: boolean; status: RuntimeStatus; alreadyRunning?: boolean; message?: string; error?: string }>(
      "/api/runtime/start",
      {
      method: "POST"
      }
    ),
  stopRuntime: () =>
    requestJson<{ ok: boolean; forced?: boolean; reason: string; status: RuntimeStatus }>(
      "/api/runtime/stop",
      { method: "POST" }
    ),
  getBootstrapStatus: () => requestJson<BootstrapStatus>("/api/bootstrap/status"),
  configureBootstrap: (body: { controlApiUrl: string; serviceToken: string }) =>
    requestJson<{ ok: true; bootstrap: BootstrapStatus }>("/api/bootstrap/configure", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  resetBootstrap: () =>
    requestJson<{ ok: true; bootstrap: BootstrapStatus }>("/api/bootstrap/reset", {
      method: "POST"
    }),
  getSettings: () => requestJson<LocalSettings>("/api/settings"),
  updateSettings: (body: Partial<LocalSettings>) =>
    requestJson<{ ok: true; settings: LocalSettings }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  listWatchedPaths: () => requestJson<{ watchedPaths: WatchedPath[] }>("/api/watched-paths"),
  addWatchedPath: (body: {
    path: string;
    pathType: "downloads" | "desktop" | "screenshots" | "custom";
    isEnabled?: boolean;
    isProtected?: boolean;
    includeSubfolders?: boolean;
  }) =>
    requestJson<{ ok: true }>("/api/watched-paths", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  deleteWatchedPath: (id: string) =>
    requestJson<{ ok: true }>(`/api/watched-paths/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  startPairing: (body: { label: string; os: "windows" | "macos" | "linux" }) =>
    requestJson<{ pairingSessionId: string; pairingCode: string; expiresAt: string }>(
      "/api/pairing/start",
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    ),
  completePairing: (pairingSessionId: string) =>
    requestJson<{ ok: true; deviceId: string; deviceToken: string; pairedAt: string }>(
      "/api/pairing/complete",
      {
        method: "POST",
        body: JSON.stringify({ pairingSessionId })
      }
    ),
  listRuns: (params?: { status?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (typeof params?.limit === "number") query.set("limit", String(params.limit));
    if (typeof params?.offset === "number") query.set("offset", String(params.offset));
    const qs = query.toString();
    return requestJson<{ runs: RunRecord[]; paging: { limit: number; offset: number; total: number } }>(
      `/api/runs${qs ? `?${qs}` : ""}`
    );
  },
  getRunDetails: (runId: string) =>
    requestJson<RunDetails>(`/api/runs/${encodeURIComponent(runId)}/details`),
  getMetrics: () => requestJson<MetricsOverview>("/api/metrics/overview"),
  enqueueRun: (body: {
    deviceId?: string;
    dryRun: boolean;
    pathKinds: Array<"custom" | "downloads" | "desktop" | "screenshots">;
    maxFiles?: number;
    allowedActions?: Array<"rename" | "move" | "archive" | "index_only" | "duplicate_group">;
    actorId?: string;
  }) =>
    requestJson<{ ok: true; runId: string; status: string }>("/api/runs/enqueue", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  approveExecute: (
    runId: string,
    body: {
      approvals: Array<{
        proposalId: string;
        decision: "approve" | "reject";
        editedAfter?: Record<string, unknown>;
      }>;
      decidedBy: { actorId: string };
      decidedAt?: string;
    }
  ) =>
    requestJson<{ ok: true; runSummary: { runId: string; status: string; actionsExecuted: number } }>(
      `/api/runs/${encodeURIComponent(runId)}/approve-execute`,
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    ),
  rollbackRun: (runId: string) =>
    requestJson<{ ok: true }>(`/api/runs/${encodeURIComponent(runId)}/rollback`, {
      method: "POST"
    })
};
