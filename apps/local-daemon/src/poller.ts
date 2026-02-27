import type { ApprovalCommand, JobProgressRequest, JobResultRequest } from "@ao/contracts";
import { nowIso } from "@ao/common";
import type { ControlApiClient } from "./control-api-client.js";
import type { LocalDaemonConfig } from "./config.js";
import { ExecutionService } from "./services/execution-service.js";
import { LocalStore } from "./services/local-store.js";
import type { PlanningProvider } from "./services/types.js";
import { RollbackService } from "./services/rollback-service.js";
import { ScanService } from "./services/scan-service.js";
import type { LocalDaemonState } from "./state.js";

export class PollWorker {
  private timer?: NodeJS.Timeout;
  private running = false;
  private acceptingJobs = false;
  private inTick = false;
  private stage: "idle" | "heartbeat" | "jobs" | "commands" = "idle";
  private activeRunId?: string;

  constructor(
    private readonly cfg: LocalDaemonConfig,
    private readonly state: LocalDaemonState,
    private readonly controlApi: ControlApiClient,
    private readonly store: LocalStore,
    private readonly scanService: ScanService,
    private readonly planningProvider: PlanningProvider,
    private readonly executionService: ExecutionService,
    private readonly rollbackService: RollbackService,
    private readonly log: Pick<Console, "info" | "warn" | "error">
  ) {}

  start() {
    if (this.running) return false;
    this.running = true;
    this.acceptingJobs = true;
    void this.tick();
    return true;
  }

  stop() {
    this.running = false;
    this.acceptingJobs = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async stopGraceful(timeoutMs = 20_000): Promise<{
    ok: boolean;
    forced: boolean;
    timeoutMs: number;
  }> {
    this.acceptingJobs = false;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const started = Date.now();
    while (this.inTick) {
      if (Date.now() - started >= timeoutMs) {
        this.log.warn(
          `poll worker stop timed out after ${timeoutMs}ms; current stage=${this.stage}`
        );
        return { ok: false, forced: true, timeoutMs };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { ok: true, forced: false, timeoutMs };
  }

  getStatus() {
    return {
      running: this.running,
      acceptingJobs: this.acceptingJobs,
      inTick: this.inTick,
      stage: this.stage,
      activeRunId: this.activeRunId
    };
  }

  private schedule(ms: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    this.inTick = true;
    try {
      this.stage = "heartbeat";
      const device = this.state.getDevice();
      if (!device.deviceId || !device.deviceToken) {
        this.schedule(5000);
        return;
      }

      const heartbeat = await this.controlApi.heartbeat({
        deviceId: device.deviceId,
        daemonVersion: this.cfg.daemonVersion,
        capabilities: ["scan", "proposals", "approvals_ui", "execute", "rollback"],
        localUiPort: this.cfg.port
      });
      this.state.markHeartbeat();

      if (this.acceptingJobs) {
        this.stage = "jobs";
        await this.processIncomingJob();
      }
      this.stage = "commands";
      await this.processRunCommands();

      this.schedule(Math.max(1000, heartbeat.pollAfterMs ?? 3000));
    } catch (error) {
      this.log.warn(`poll worker tick failed: ${String(error)}`);
      this.schedule(5000);
    } finally {
      this.stage = "idle";
      this.activeRunId = undefined;
      this.inTick = false;
    }
  }

  private async processIncomingJob() {
    const next = await this.controlApi.nextJob();
    if (!next.job) return;

    const job = next.job;
    this.log.info(`received job ${job.jobId} (${job.kind}) for device ${job.deviceId}`);
    await this.controlApi.ackJob(job.jobId);

    const localRun = this.state.createRunFromJob(job, next.runId);
    const runId = localRun.snapshot.runSummary.runId;
    this.activeRunId = runId;
    this.store.createRun(runId, job);

    await this.pushProgress(job.jobId, runId, "running", "scan_started", "Scanning selected folders");
    const scanResult = await this.scanService.scanJobScope(job);
    if (scanResult.matchedWatchedPaths === 0) {
      const errorMessage = "no_enabled_watched_paths_for_scope";
      this.state.setRunStatus(runId, "failed", {
        finishedAt: nowIso(),
        filesScanned: 0,
        proposalsCreated: 0,
        actionsExecuted: 0,
        skippedForSafety: 0,
        errorMessage
      });
      this.state.appendProgress(
        runId,
        "scan_completed",
        "No enabled watched paths match requested scope.",
        {
          pathKinds: job.scope.pathKinds ?? [],
          pathIds: job.scope.pathIds ?? [],
          errorMessage
        }
      );
      this.store.updateRunSummary(runId, this.state.getRun(runId)?.snapshot.runSummary ?? {});
      await this.pushProgress(
        job.jobId,
        runId,
        "failed",
        "scan_completed",
        "No enabled watched paths match requested scope.",
        {
          pathKinds: job.scope.pathKinds ?? [],
          pathIds: job.scope.pathIds ?? [],
          errorMessage
        }
      );
      await this.pushRunResult(job.jobId, runId);
      return;
    }
    const classified = await this.planningProvider.classifyFiles(scanResult.candidates);
    await this.pushProgress(
      job.jobId,
      runId,
      "running",
      "scan_completed",
      "Metadata scan completed",
      {
        filesScanned: classified.length,
        skippedForSafety: scanResult.skippedForSafety
      }
    );
    await this.pushProgress(
      job.jobId,
      runId,
      "running",
      "classification_completed",
      "Rules-first classification completed"
    );
    const proposals = await this.planningProvider.proposeActions({
      runId,
      job,
      candidates: classified
    });
    await this.pushProgress(
      job.jobId,
      runId,
      "running",
      "proposal_generation_completed",
      "Classification and proposal generation completed"
    );
    this.store.replaceRunProposals(runId, proposals);
    this.state.seedProposals(runId, proposals, {
      filesScanned: classified.length,
      skippedForSafety: scanResult.skippedForSafety
    });
    this.state.setRunStatus(runId, "awaiting_approval", {
      filesScanned: classified.length,
      proposalsCreated: proposals.length,
      skippedForSafety: scanResult.skippedForSafety
    });
    this.store.updateRunSummary(runId, this.state.getRun(runId)?.snapshot.runSummary ?? {});
    this.state.appendProgress(runId, "awaiting_approval", "Waiting for local user approvals");
    await this.pushProgress(
      job.jobId,
      runId,
      "awaiting_approval",
      "awaiting_approval",
      "Awaiting local user approvals"
    );

    await this.pushRunResult(job.jobId, runId);
  }

  private async processRunCommands() {
    for (const run of this.state.listRuns()) {
      const runId = run.snapshot.runSummary.runId;
      if (!run.job.deviceId) continue;
      const commands = await this.controlApi.fetchRunCommands(runId);

      if (commands.approvals && run.snapshot.runSummary.status === "awaiting_approval") {
        this.applyApprovals(runId, commands.approvals);
        await this.pushRunResult(run.job.jobId, runId);
      }

      if (commands.execute && run.snapshot.runSummary.status === "ready_to_execute") {
        this.state.appendProgress(runId, "execution_started", "Executing approved proposals");
        this.state.setRunStatus(runId, "executing");
        this.store.updateRunSummary(runId, this.state.getRun(runId)?.snapshot.runSummary ?? {});
        await this.pushProgress(
          run.job.jobId,
          runId,
          "executing",
          "execution_started",
          "Executing approved proposals"
        );
        try {
          const result = await this.executionService.executeApproved(run.snapshot);
          this.state.setRunSnapshot(runId, result.nextSnapshot);
          this.state.appendProgress(runId, "execution_completed", "Execution finished");
          await this.pushProgress(
            run.job.jobId,
            runId,
            "completed",
            "execution_completed",
            "Execution completed",
            { actionsExecuted: result.nextSnapshot.runSummary.actionsExecuted }
          );
        } catch (error) {
          const message = String(error);
          if (message.includes("dry_run_execution_blocked")) {
            this.state.appendProgress(
              runId,
              "execution_blocked",
              "Execution blocked because run is dry-run."
            );
            this.state.setRunStatus(runId, "ready_to_execute");
            this.store.updateRunSummary(
              runId,
              this.state.getRun(runId)?.snapshot.runSummary ?? {}
            );
          } else {
            this.state.setRunStatus(runId, "failed", {
              finishedAt: nowIso(),
              errorMessage: message
            });
            this.store.markRunFailed(runId, message);
          }
        }
        await this.pushRunResult(run.job.jobId, runId);
      }

      if (commands.rollback && run.snapshot.runSummary.actionsExecuted > 0) {
        const next = await this.rollbackService.rollbackRun(run.snapshot);
        this.state.setRunSnapshot(runId, next);
        this.state.appendProgress(runId, "rollback_completed", "Rollback completed");
        await this.pushRunResult(run.job.jobId, runId);
      }
    }
  }

  private applyApprovals(runId: string, approvals: ApprovalCommand) {
    this.state.applyApprovals(runId, approvals);
    this.store.applyApprovals(approvals);
    this.store.updateRunSummary(runId, this.state.getRun(runId)?.snapshot.runSummary ?? {});
    this.state.appendProgress(runId, "approvals_applied", "Local approvals applied");
  }

  private async pushProgress(
    jobId: string,
    runId: string,
    status: JobProgressRequest["status"],
    stage: JobProgressRequest["progress"]["stage"],
    message: string,
    data?: Record<string, unknown>
  ) {
    await this.controlApi.postJobProgress(jobId, {
      runId,
      status,
      progress: {
        at: nowIso(),
        stage,
        message,
        data
      }
    });
  }

  private async pushRunResult(jobId: string, runId: string) {
    const run = this.state.getRun(runId);
    if (!run) return;
    const payload: JobResultRequest = {
      runId,
      result: run.snapshot
    };
    await this.controlApi.postJobResult(jobId, payload);
  }
}
