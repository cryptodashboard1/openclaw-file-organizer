import type { ProposalResult } from "@ao/contracts";
import { ClassificationService } from "./classification-service.js";
import { ProposalService } from "./proposal-service.js";
import type {
  LocalSettings,
  PlanningProvider,
  ProposalGenerationContext,
  ScanCandidate
} from "./types.js";

export class RulesOnlyPlanningProvider implements PlanningProvider {
  constructor(
    private readonly classificationService: ClassificationService,
    private readonly proposalService: ProposalService,
    private readonly getSettings: () => LocalSettings
  ) {}

  async classifyFiles(candidates: ScanCandidate[]): Promise<ScanCandidate[]> {
    return this.classificationService.classifyBatch(candidates);
  }

  async proposeActions(
    context: ProposalGenerationContext
  ): Promise<ProposalResult[]> {
    return this.proposalService.generate(context, this.getSettings());
  }
}
