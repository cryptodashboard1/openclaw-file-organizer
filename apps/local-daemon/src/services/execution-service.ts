import fs from "node:fs/promises";
import path from "node:path";
import type { ProposalResult, RunSnapshot } from "@ao/contracts";
import { createId, nowIso } from "@ao/common";
import { LocalStore } from "./local-store.js";
import { PathPolicyService } from "./path-policy-service.js";
import type { ExecutionRecord } from "./types.js";

export class ExecutionService {
  constructor(
    private readonly store: LocalStore,
    private readonly pathPolicy: PathPolicyService
  ) {}

  async executeApproved(snapshot: RunSnapshot): Promise<{
    nextSnapshot: RunSnapshot;
    executionRecords: ExecutionRecord[];
  }> {
    if (snapshot.runSummary.dryRun) {
      throw new Error("dry_run_execution_blocked");
    }

    const proposals = [...snapshot.proposals];
    const runId = snapshot.runSummary.runId;
    const executionRecords: ExecutionRecord[] = [];
    let executed = 0;

    for (let i = 0; i < proposals.length; i += 1) {
      const proposal = proposals[i];
      if (proposal.status !== "approved") continue;

      const startedAt = nowIso();
      const sourcePath = String(proposal.before.path ?? "");
      const targetPath = String(proposal.after.path ?? "");

      const unsupported =
        !["rename", "move", "archive"].includes(proposal.actionType);
      if (unsupported) {
        proposals[i] = { ...proposal, status: "failed" };
        const rec = this.makeExecutionRecord({
          runId,
          proposalId: proposal.proposalId,
          operationType: proposal.actionType,
          success: false,
          errorMessage: "unsupported_action_for_execution",
          rollbackJson: undefined,
          startedAt
        });
        executionRecords.push(rec);
        this.persistExecutionFailure(proposal, rec);
        continue;
      }

      const policy = this.pathPolicy.validateOperationPaths({
        actionType: proposal.actionType,
        sourcePath,
        targetPath
      });
      if (!policy.allowed) {
        proposals[i] = { ...proposal, status: "failed" };
        const rec = this.makeExecutionRecord({
          runId,
          proposalId: proposal.proposalId,
          operationType: proposal.actionType,
          success: false,
          errorMessage: policy.reason ?? "policy_denied",
          rollbackJson: undefined,
          startedAt
        });
        executionRecords.push(rec);
        this.persistExecutionFailure(proposal, rec);
        continue;
      }

      try {
        await fs.access(sourcePath);
      } catch {
        proposals[i] = { ...proposal, status: "failed" };
        const rec = this.makeExecutionRecord({
          runId,
          proposalId: proposal.proposalId,
          operationType: proposal.actionType,
          success: false,
          errorMessage: "source_missing",
          rollbackJson: undefined,
          startedAt
        });
        executionRecords.push(rec);
        this.persistExecutionFailure(proposal, rec);
        continue;
      }

      try {
        await fs.access(targetPath);
        proposals[i] = { ...proposal, status: "failed" };
        const rec = this.makeExecutionRecord({
          runId,
          proposalId: proposal.proposalId,
          operationType: proposal.actionType,
          success: false,
          errorMessage: "target_exists_no_overwrite",
          rollbackJson: undefined,
          startedAt
        });
        executionRecords.push(rec);
        this.persistExecutionFailure(proposal, rec);
        continue;
      } catch {
        // target doesn't exist, continue
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.rename(sourcePath, targetPath);

      const finishedAt = nowIso();
      const rollbackJson = JSON.stringify({
        type: "move_back",
        from: targetPath,
        to: sourcePath
      });
      const rec = this.makeExecutionRecord({
        runId,
        proposalId: proposal.proposalId,
        operationType: proposal.actionType,
        success: true,
        rollbackJson,
        startedAt,
        finishedAt
      });
      executionRecords.push(rec);

      executed += 1;
      proposals[i] = { ...proposal, status: "executed" };
      this.store.updateProposalStatus(proposal.proposalId, "executed", finishedAt);
      this.store.insertExecution(rec);
      this.store.updateFilePath(proposal.fileId, targetPath);
    }

    const nextSummary = {
      ...snapshot.runSummary,
      status: "completed" as const,
      finishedAt: nowIso(),
      actionsExecuted: executed
    };
    this.store.updateRunSummary(runId, nextSummary);

    return {
      nextSnapshot: {
        runSummary: nextSummary,
        proposals
      },
      executionRecords
    };
  }

  private makeExecutionRecord(input: {
    runId: string;
    proposalId: string;
    operationType: string;
    success: boolean;
    errorMessage?: string;
    rollbackJson?: string;
    startedAt: string;
    finishedAt?: string;
  }): ExecutionRecord {
    return {
      executionId: createId("exec"),
      runId: input.runId,
      proposalId: input.proposalId,
      operationType: input.operationType,
      success: input.success,
      errorMessage: input.errorMessage,
      rollbackJson: input.rollbackJson,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt ?? nowIso()
    };
  }

  private persistExecutionFailure(proposal: ProposalResult, record: ExecutionRecord) {
    this.store.updateProposalStatus(proposal.proposalId, "failed");
    this.store.insertExecution(record);
  }
}
