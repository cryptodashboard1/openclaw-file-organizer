import type { LocalDaemonConfig } from "../config.js";
import { openLocalDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { ClassificationService } from "./classification-service.js";
import { ExecutionService } from "./execution-service.js";
import { LocalStore } from "./local-store.js";
import { PathPolicyService } from "./path-policy-service.js";
import { RulesOnlyPlanningProvider } from "./planning-provider.js";
import { ProposalService } from "./proposal-service.js";
import { RollbackService } from "./rollback-service.js";
import { ScanService } from "./scan-service.js";
import { SettingsService } from "./settings-service.js";
import { WatchedPathsService } from "./watched-paths-service.js";

export type RuntimeServices = {
  db: unknown;
  store: LocalStore;
  settingsService: SettingsService;
  watchedPathsService: WatchedPathsService;
  pathPolicyService: PathPolicyService;
  scanService: ScanService;
  classificationService: ClassificationService;
  proposalService: ProposalService;
  planningProvider: RulesOnlyPlanningProvider;
  executionService: ExecutionService;
  rollbackService: RollbackService;
};

export function createRuntimeServices(cfg: LocalDaemonConfig): RuntimeServices {
  const db = openLocalDb(cfg.localDbPath);
  runMigrations(db);
  const store = new LocalStore(db);
  store.initializeDefaults({
    organizedRootPath: cfg.organizedRootPath,
    recentFileSafetyHours: cfg.recentFileSafetyHours,
    includeHiddenDefault: cfg.includeHiddenDefault,
    seedDefaultWatchedPaths: cfg.seedDefaultWatchedPaths
  });

  const settingsService = new SettingsService(store);
  const watchedPathsService = new WatchedPathsService(store);
  const pathPolicyService = new PathPolicyService(
    () => settingsService.getSettings(),
    () => watchedPathsService.list()
  );
  const scanService = new ScanService(
    store,
    pathPolicyService,
    () => watchedPathsService.list(),
    cfg.includeHiddenDefault
  );
  const classificationService = new ClassificationService();
  const proposalService = new ProposalService(pathPolicyService);
  const planningProvider = new RulesOnlyPlanningProvider(
    classificationService,
    proposalService,
    () => settingsService.getSettings()
  );
  const executionService = new ExecutionService(store, pathPolicyService);
  const rollbackService = new RollbackService(store);

  return {
    db,
    store,
    settingsService,
    watchedPathsService,
    pathPolicyService,
    scanService,
    classificationService,
    proposalService,
    planningProvider,
    executionService,
    rollbackService
  };
}
