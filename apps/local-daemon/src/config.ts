export type LocalDaemonConfig = {
  port: number;
  host: string;
  controlApiUrl: string;
  deviceId?: string;
  deviceToken?: string;
  daemonVersion: string;
  serviceToken?: string;
  localDbPath: string;
  organizedRootPath?: string;
  recentFileSafetyHours: number;
  includeHiddenDefault: boolean;
  seedDefaultWatchedPaths: boolean;
  deviceCredentialTarget: string;
  bootstrapConfigPath: string;
  runtimeStopTimeoutMs: number;
};

export function loadConfig(): LocalDaemonConfig {
  const userHome =
    process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();

  return {
    port: Number(process.env.AO_DAEMON_PORT ?? process.env.PORT ?? 5050),
    host: process.env.AO_DAEMON_HOST ?? process.env.HOST ?? "127.0.0.1",
    controlApiUrl: process.env.AO_CONTROL_API_URL ?? "http://127.0.0.1:4040",
    deviceId: process.env.AO_DEVICE_ID,
    deviceToken: process.env.AO_DEVICE_TOKEN,
    daemonVersion: process.env.AO_DAEMON_VERSION ?? "0.1.0-dev",
    serviceToken: process.env.AO_CONTROL_API_SERVICE_TOKEN,
    localDbPath:
      process.env.AO_LOCAL_DB_PATH ??
      `${userHome}\\AppData\\Local\\AutoOrganizer\\local-daemon.sqlite`,
    organizedRootPath: process.env.AO_ORGANIZED_ROOT_PATH,
    recentFileSafetyHours: Number(process.env.AO_RECENT_FILE_SAFETY_HOURS ?? 12),
    includeHiddenDefault:
      String(process.env.AO_INCLUDE_HIDDEN_DEFAULT ?? "false").toLowerCase() ===
      "true",
    seedDefaultWatchedPaths:
      String(process.env.AO_SEED_DEFAULT_WATCHED_PATHS ?? "false").toLowerCase() ===
      "true",
    deviceCredentialTarget:
      process.env.AO_DEVICE_CREDENTIAL_TARGET ?? "auto-organizer.local-daemon",
    bootstrapConfigPath:
      process.env.AO_BOOTSTRAP_CONFIG_PATH ??
      `${userHome}\\AppData\\Roaming\\AutoOrganizer\\bootstrap-config.json`,
    runtimeStopTimeoutMs: Number(process.env.AO_RUNTIME_STOP_TIMEOUT_MS ?? 20_000)
  };
}
