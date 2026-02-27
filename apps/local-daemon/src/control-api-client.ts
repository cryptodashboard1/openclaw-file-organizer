import type {
  ApprovalCommand,
  CleanupJob,
  DeviceHeartbeatRequest,
  DeviceHeartbeatResponse,
  ExecuteCommand,
  JobProgressRequest,
  JobResultRequest,
  PairingCompleteResponse,
  PairingStartRequest,
  PairingStartResponse,
  RollbackCommand
} from "@ao/contracts";

type ClientConfig = {
  baseUrl: string;
  deviceToken?: string;
  serviceToken?: string;
};

export class ControlApiClient {
  constructor(private config: ClientConfig) {}

  setBaseUrl(baseUrl: string) {
    this.config.baseUrl = baseUrl;
  }

  setDeviceToken(token: string) {
    this.config.deviceToken = token;
  }

  setServiceToken(token?: string) {
    this.config.serviceToken = token;
  }

  getConfig() {
    return { ...this.config };
  }

  private async request<T>(path: string, init: RequestInit, auth: "device" | "service" | "none" = "none"): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    headers.set("content-type", "application/json");
    if (auth === "device" && this.config.deviceToken) {
      headers.set("authorization", `Bearer ${this.config.deviceToken}`);
    }
    if (auth === "service" && this.config.serviceToken) {
      headers.set("x-ao-service-token", this.config.serviceToken);
    }

    const response = await fetch(`${this.config.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`control api ${response.status} ${response.statusText}: ${bodyText}`);
    }
    return (await response.json()) as T;
  }

  startPairing(input: PairingStartRequest): Promise<PairingStartResponse> {
    return this.request("/v1/pairing/start", { method: "POST", body: JSON.stringify(input) }, "service");
  }

  completePairing(pairingSessionId: string): Promise<PairingCompleteResponse> {
    return this.request("/v1/pairing/complete", {
      method: "POST",
      body: JSON.stringify({ pairingSessionId })
    });
  }

  enqueueJob(job: CleanupJob): Promise<{ job: CleanupJob; runId: string; status: string }> {
    return this.request(
      "/v1/jobs",
      {
        method: "POST",
        body: JSON.stringify(job)
      },
      "service"
    );
  }

  heartbeat(input: DeviceHeartbeatRequest): Promise<DeviceHeartbeatResponse & { device?: unknown }> {
    return this.request("/v1/device/heartbeat", { method: "POST", body: JSON.stringify(input) }, "device");
  }

  nextJob(): Promise<{ job: CleanupJob | null; runId?: string }> {
    return this.request("/v1/device/jobs/next", { method: "GET" }, "device");
  }

  ackJob(jobId: string): Promise<{ ok: true }> {
    return this.request(`/v1/device/jobs/${jobId}/ack`, { method: "POST", body: JSON.stringify({ acknowledgedAt: new Date().toISOString() }) }, "device");
  }

  postJobProgress(jobId: string, input: JobProgressRequest): Promise<{ ok: true }> {
    return this.request(`/v1/device/jobs/${jobId}/progress`, { method: "POST", body: JSON.stringify(input) }, "device");
  }

  postJobResult(jobId: string, input: JobResultRequest): Promise<{ ok: true }> {
    return this.request(`/v1/device/jobs/${jobId}/result`, { method: "POST", body: JSON.stringify(input) }, "device");
  }

  fetchRunCommands(runId: string): Promise<{
    approvals: ApprovalCommand | null;
    execute: ExecuteCommand | null;
    rollback: RollbackCommand | null;
  }> {
    return this.request(`/v1/runs/${runId}/commands`, { method: "GET" }, "device");
  }
}
