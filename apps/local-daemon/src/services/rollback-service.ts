import fs from "node:fs/promises";
import path from "node:path";
import type { RunSnapshot } from "@ao/contracts";
import { createId, nowIso } from "@ao/common";
import { LocalStore } from "./local-store.js";

type RollbackJson = {
  type: "move_back" | "rename_back";
  from: string;
  to: string;
};

export class RollbackService {
  constructor(private readonly store: LocalStore) {}

  async rollbackRun(snapshot: RunSnapshot): Promise<RunSnapshot> {
    const runId = snapshot.runSummary.runId;
    const executions = this.store
      .listExecutionsByRun(runId)
      .filter(
        (record) =>
          record.success &&
          record.operationType !== "rollback" &&
          !!record.rollbackJson
      );

    const proposals = [...snapshot.proposals];
    let remainingExecuted = snapshot.runSummary.actionsExecuted;

    for (const execution of executions) {
      const proposalIndex = proposals.findIndex(
        (proposal) => proposal.proposalId === execution.proposalId
      );
      const proposal = proposalIndex >= 0 ? proposals[proposalIndex] : null;
      const ok = await this.applyRollback(execution.rollbackJson!);

      this.store.insertExecution({
        executionId: createId("exec"),
        runId,
        proposalId: execution.proposalId,
        operationType: "rollback",
        success: ok,
        errorMessage: ok ? undefined : "rollback_failed",
        startedAt: nowIso(),
        finishedAt: nowIso()
      });

      if (ok && proposal) {
        proposals[proposalIndex] = { ...proposal, status: "approved" };
        this.store.updateProposalStatus(proposal.proposalId, "approved");
        const toPath = String(proposal.before.path ?? "");
        if (toPath) {
          this.store.updateFilePath(proposal.fileId, toPath);
        }
        remainingExecuted = Math.max(0, remainingExecuted - 1);
      }
    }

    const nextSummary = {
      ...snapshot.runSummary,
      status: "completed" as const,
      actionsExecuted: remainingExecuted
    };
    this.store.updateRunSummary(runId, nextSummary);
    return { runSummary: nextSummary, proposals };
  }

  async rollbackExecution(executionId: string): Promise<{ ok: boolean; runId?: string; proposalId?: string }> {
    const execution = this.store.getExecution(executionId);
    if (!execution || !execution.success || !execution.rollbackJson) {
      return { ok: false };
    }
    const ok = await this.applyRollback(execution.rollbackJson);
    this.store.insertExecution({
      executionId: createId("exec"),
      runId: execution.runId,
      proposalId: execution.proposalId,
      operationType: "rollback",
      success: ok,
      errorMessage: ok ? undefined : "rollback_failed",
      startedAt: nowIso(),
      finishedAt: nowIso()
    });

    if (ok) {
      this.store.updateProposalStatus(execution.proposalId, "approved");
      const proposal = this.store.getProposalById(execution.proposalId);
      const toPath = String(proposal?.before.path ?? "");
      if (proposal && toPath) {
        this.store.updateFilePath(proposal.fileId, toPath);
      }
    }

    return { ok, runId: execution.runId, proposalId: execution.proposalId };
  }

  private async applyRollback(rollbackJson: string): Promise<boolean> {
    let parsed: RollbackJson;
    try {
      parsed = JSON.parse(rollbackJson) as RollbackJson;
    } catch {
      return false;
    }
    try {
      await fs.access(parsed.from);
      await fs.access(parsed.to);
      return false; // do not overwrite on rollback either
    } catch {
      // target path likely absent, continue
    }
    try {
      await fs.mkdir(path.dirname(parsed.to), { recursive: true });
      await fs.rename(parsed.from, parsed.to);
      return true;
    } catch {
      return false;
    }
  }
}
