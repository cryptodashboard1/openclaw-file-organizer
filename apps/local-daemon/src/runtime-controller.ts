import { nowIso } from "@ao/common";
import type { PollWorker } from "./poller.js";

export type RuntimeConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "stopping";

export type RuntimeStatusSnapshot = {
  state: RuntimeConnectionState;
  poller: ReturnType<PollWorker["getStatus"]>;
  lastStartedAt?: string;
  lastStoppedAt?: string;
  lastError?: string;
};

export class RuntimeController {
  private state: RuntimeConnectionState = "disconnected";
  private lastStartedAt?: string;
  private lastStoppedAt?: string;
  private lastError?: string;

  constructor(
    private readonly poller: PollWorker,
    private readonly stopTimeoutMs = 20_000
  ) {}

  status(): RuntimeStatusSnapshot {
    return {
      state: this.state,
      poller: this.poller.getStatus(),
      lastStartedAt: this.lastStartedAt,
      lastStoppedAt: this.lastStoppedAt,
      lastError: this.lastError
    };
  }

  async startConnection() {
    if (this.state === "connected" || this.state === "connecting") {
      return { ok: true as const, status: this.status(), alreadyRunning: true };
    }
    this.state = "connecting";
    try {
      this.poller.start();
      this.state = "connected";
      this.lastStartedAt = nowIso();
      this.lastError = undefined;
      return { ok: true as const, status: this.status(), alreadyRunning: false };
    } catch (error) {
      this.state = "disconnected";
      this.lastError = String(error);
      return {
        ok: false as const,
        status: this.status(),
        message: "runtime_start_failed",
        error: this.lastError
      };
    }
  }

  async stopConnectionGraceful(reason = "manual_stop") {
    if (this.state === "disconnected") {
      return {
        ok: true as const,
        status: this.status(),
        alreadyStopped: true,
        reason
      };
    }
    this.state = "stopping";
    const result = await this.poller.stopGraceful(this.stopTimeoutMs);
    this.state = "disconnected";
    this.lastStoppedAt = nowIso();
    if (!result.ok) {
      this.lastError = `runtime_stop_timeout:${this.stopTimeoutMs}`;
    }
    return {
      ok: result.ok,
      forced: result.forced,
      status: this.status(),
      reason
    };
  }
}
