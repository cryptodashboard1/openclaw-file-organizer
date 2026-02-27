import fs from "node:fs";
import path from "node:path";
import type { ProposalResult } from "@ao/contracts";
import { createId } from "@ao/common";
import { PathPolicyService } from "./path-policy-service.js";
import type {
  LocalSettings,
  ProposalGenerationContext,
  ScanCandidate
} from "./types.js";

const GENERIC_BASE_RE =
  /^(img[_-]?\d+|document(?: ?\(\d+\))?|untitled(?: ?\(\d+\))?|new[-_ ]?document|scan(?: ?\(\d+\))?)$/i;

export class ProposalService {
  constructor(private readonly pathPolicy: PathPolicyService) {}

  generate(
    context: ProposalGenerationContext,
    settings: LocalSettings
  ): ProposalResult[] {
    const proposals: ProposalResult[] = [];
    for (const candidate of context.candidates) {
      const generated = this.generateForCandidate(
        candidate,
        context.job.mode.allowedActions,
        settings
      );
      if (generated) {
        proposals.push(generated);
      }
    }
    return proposals;
  }

  private generateForCandidate(
    candidate: ScanCandidate,
    allowedActions: string[],
    settings: LocalSettings
  ): ProposalResult | null {
    const ext = candidate.extension.startsWith(".")
      ? candidate.extension
      : `.${candidate.extension}`;
    const base = path.basename(candidate.filename, ext);
    const normalizedDate = this.pickDate(candidate);
    const label = candidate.generatedLabel ?? this.slug(base);
    const lowerClass = (candidate.classification ?? "unknown").toLowerCase();

    const canMoveScreenshots =
      allowedActions.includes("move") && lowerClass.startsWith("screenshot");
    const canArchiveInstaller =
      allowedActions.includes("archive") && lowerClass === "installer";
    const canRenameGeneric =
      allowedActions.includes("rename") && GENERIC_BASE_RE.test(base);

    if (canMoveScreenshots) {
      const yyyyMm = normalizedDate.slice(0, 7);
      const targetBase = `${normalizedDate}_${label || "screenshot"}_v1${ext}`;
      const targetPath = this.resolveCollision(
        path.join(settings.organizedRootPath, "Screenshots", yyyyMm, targetBase)
      );
      return this.createProposal(candidate, {
        actionType: "move",
        reason: "Screenshot pattern detected. Move into organized screenshot structure.",
        targetPath,
        riskLevel: "low",
        confidence: Math.max(0.75, candidate.confidence ?? 0.8),
        approvalRequired: true
      });
    }

    if (canArchiveInstaller) {
      const targetBase = `${normalizedDate}_${label || "installer"}_v1${ext}`;
      const targetPath = this.resolveCollision(
        path.join(settings.archiveRootPath, "Installers", targetBase)
      );
      return this.createProposal(candidate, {
        actionType: "archive",
        reason: "Installer file detected. Archive move suggested.",
        targetPath,
        riskLevel: "medium",
        confidence: Math.max(0.7, candidate.confidence ?? 0.75),
        approvalRequired: true
      });
    }

    if (canRenameGeneric) {
      const targetBase = `${normalizedDate}_${label || "document"}_v1${ext}`;
      const targetPath = this.resolveCollision(
        path.join(candidate.parentPath, targetBase)
      );
      return this.createProposal(candidate, {
        actionType: "rename",
        reason: "Generic filename detected. Rename for consistency.",
        targetPath,
        riskLevel: "low",
        confidence: Math.max(0.68, candidate.confidence ?? 0.7),
        approvalRequired: true
      });
    }

    if ((candidate.manualReview ?? false) || (candidate.confidence ?? 0) < 0.6) {
      return this.createProposal(candidate, {
        actionType: "manual_review",
        reason: "Low-confidence classification. Needs manual review.",
        targetPath: candidate.absolutePath,
        riskLevel: "high",
        confidence: candidate.confidence ?? 0.5,
        approvalRequired: true
      });
    }

    if (allowedActions.includes("index_only")) {
      return this.createProposal(candidate, {
        actionType: "index_only",
        reason: "No safe organization action needed. Index only.",
        targetPath: candidate.absolutePath,
        riskLevel: "low",
        confidence: candidate.confidence ?? 0.7,
        approvalRequired: false
      });
    }

    return null;
  }

  private createProposal(
    candidate: ScanCandidate,
    input: {
      actionType: ProposalResult["actionType"];
      reason: string;
      targetPath: string;
      riskLevel: ProposalResult["riskLevel"];
      confidence: number;
      approvalRequired: boolean;
    }
  ): ProposalResult {
    const decision = this.pathPolicy.validateOperationPaths({
      actionType: input.actionType,
      sourcePath: candidate.absolutePath,
      targetPath: input.targetPath
    });

    if (!decision.allowed) {
      return {
        proposalId: createId("prop"),
        fileId: candidate.fileId,
        actionType: "manual_review",
        reason: `Policy gate: ${decision.reason ?? "path not allowed"}.`,
        before: { path: candidate.absolutePath },
        after: { path: candidate.absolutePath },
        riskLevel: "high",
        approvalRequired: true,
        confidence: Math.min(0.59, input.confidence),
        rollbackPlan: { type: "none" },
        status: "proposed"
      };
    }

    return {
      proposalId: createId("prop"),
      fileId: candidate.fileId,
      actionType: input.actionType,
      reason: input.reason,
      before: { path: candidate.absolutePath },
      after: { path: input.targetPath },
      riskLevel: input.riskLevel,
      approvalRequired: input.approvalRequired,
      confidence: input.confidence,
      rollbackPlan: {
        type: "move_back",
        target: candidate.absolutePath
      },
      status: "proposed"
    };
  }

  private pickDate(candidate: ScanCandidate): string {
    const preferred =
      candidate.createdAtFs ??
      candidate.modifiedAtFs ??
      new Date().toISOString();
    return preferred.slice(0, 10);
  }

  private slug(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70);
  }

  private resolveCollision(targetPath: string): string {
    if (!fs.existsSync(targetPath)) return targetPath;
    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const without = path.basename(targetPath, ext);
    const match = without.match(/_v(\d+)$/i);
    const base = match ? without.slice(0, -match[0].length) : without;
    let version = match ? Number(match[1]) : 1;
    let candidate = targetPath;
    while (fs.existsSync(candidate)) {
      version += 1;
      candidate = path.join(dir, `${base}_v${version}${ext}`);
    }
    return candidate;
  }
}
