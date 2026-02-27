import type { CleanupJob, ProposalResult } from "@ao/contracts";
import { createId } from "@ao/common";

export function buildSeedProposals(job: CleanupJob): ProposalResult[] {
  const dryRunPathPrefix = "C:/Users/me";
  const proposals: ProposalResult[] = [
    {
      proposalId: createId("prop"),
      fileId: createId("file"),
      actionType: "move",
      reason: "Invoice candidate belongs in Organized/Documents/Bills.",
      before: {
        path: `${dryRunPathPrefix}/Downloads/document (4).pdf`
      },
      after: {
        path: `${dryRunPathPrefix}/Organized/Documents/Bills/2026-02-26_invoice_verizon_v1.pdf`
      },
      riskLevel: "medium",
      approvalRequired: true,
      confidence: 0.87,
      rollbackPlan: {
        type: "move_back",
        target: `${dryRunPathPrefix}/Downloads/document (4).pdf`
      },
      status: "proposed"
    },
    {
      proposalId: createId("prop"),
      fileId: createId("file"),
      actionType: "move",
      reason: "Detected screenshot dimensions and desktop capture pattern.",
      before: {
        path: `${dryRunPathPrefix}/Desktop/IMG_4821.png`
      },
      after: {
        path: `${dryRunPathPrefix}/Organized/Screenshots/2026-02/2026-02-26_screenshot_whatsapp-warning_v1.png`
      },
      riskLevel: "low",
      approvalRequired: true,
      confidence: 0.92,
      rollbackPlan: {
        type: "move_back",
        target: `${dryRunPathPrefix}/Desktop/IMG_4821.png`
      },
      status: "proposed"
    },
    {
      proposalId: createId("prop"),
      fileId: createId("file"),
      actionType: "archive",
      reason: "Old installer in Downloads, safe archive move recommended.",
      before: {
        path: `${dryRunPathPrefix}/Downloads/chrome_installer(2).exe`
      },
      after: {
        path: `${dryRunPathPrefix}/Organized/Archives/Installers/chrome_installer_v2.exe`
      },
      riskLevel: "medium",
      approvalRequired: true,
      confidence: 0.79,
      rollbackPlan: {
        type: "move_back",
        target: `${dryRunPathPrefix}/Downloads/chrome_installer(2).exe`
      },
      status: "proposed"
    }
  ];

  return proposals.filter((proposal) =>
    proposal.actionType === "archive" ? job.mode.allowedActions.includes("archive") : true
  );
}
