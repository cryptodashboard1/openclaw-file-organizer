import type {
  ApprovalCommand,
  CleanupJob,
  RunSnapshot,
  RunSummary
} from "@ao/contracts";

export type AoControlClientConfig = {
  baseUrl: string;
  serviceToken?: string;
};

export class AoControlClient {
  constructor(private readonly cfg: AoControlClientConfig) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    headers.set("content-type", "application/json");
    if (this.cfg.serviceToken) {
      headers.set("x-ao-service-token", this.cfg.serviceToken);
    }

    const res = await fetch(`${this.cfg.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      throw new Error(`AO control API ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  listDevices(): Promise<{ devices: Array<Record<string, unknown>> }> {
    return this.request("/v1/devices");
  }

  getDeviceStatus(deviceId: string): Promise<{ device: Record<string, unknown> }> {
    return this.request(`/v1/devices/${deviceId}/status`);
  }

  enqueueCleanupJob(job: CleanupJob): Promise<{ job: CleanupJob; runId: string; status: string }> {
    return this.request("/v1/jobs", { method: "POST", body: JSON.stringify(job) });
  }

  getJob(jobId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/jobs/${jobId}`);
  }

  getRunSummary(runId: string): Promise<{ summary: RunSummary }> {
    return this.request(`/v1/runs/${runId}/summary`);
  }

  getRun(runId: string): Promise<{ snapshot: RunSnapshot; progress: Array<Record<string, unknown>> }> {
    return this.request(`/v1/runs/${runId}`);
  }

  listRunProposals(runId: string): Promise<{ proposals: Array<Record<string, unknown>> }> {
    return this.request(`/v1/runs/${runId}/proposals`);
  }

  submitApprovals(runId: string, approvals: ApprovalCommand): Promise<{ ok: true }> {
    return this.request(`/v1/runs/${runId}/approvals`, {
      method: "POST",
      body: JSON.stringify(approvals)
    });
  }

  requestExecute(runId: string): Promise<{ ok: true }> {
    return this.request(`/v1/runs/${runId}/execute`, {
      method: "POST",
      body: JSON.stringify({ runId, executeApproved: true, requestedAt: new Date().toISOString() })
    });
  }

  requestRollback(runId: string, executionIds?: string[]): Promise<{ ok: true }> {
    return this.request(`/v1/runs/${runId}/rollback`, {
      method: "POST",
      body: JSON.stringify({ runId, executionIds, requestedAt: new Date().toISOString() })
    });
  }
}

