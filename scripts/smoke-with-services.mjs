import { spawn } from "node:child_process";

const root = process.cwd();
const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHealthy(url) {
  try {
    const res = await fetch(`${url}/health`);
    if (!res.ok) return false;
    const json = await res.json();
    return json?.ok === true;
  } catch {
    return false;
  }
}

async function waitForHealth(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isHealthy(url)) return;
    await sleep(400);
  }
  throw new Error(`timed out waiting for health: ${url}`);
}

function startService(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: {
      ...process.env,
      ...env
    },
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  return child;
}

async function run() {
  const controlApiUrl = process.env.AO_CONTROL_API_URL ?? "http://127.0.0.1:4040";
  const daemonApiUrl = process.env.AO_DAEMON_API_URL ?? "http://127.0.0.1:5050";
  const controlPort = new URL(controlApiUrl).port || "4040";
  const daemonPort = new URL(daemonApiUrl).port || "5050";
  const host = process.env.HOST ?? "127.0.0.1";

  let startedVps = false;
  let startedDaemon = false;
  let vps;
  let daemon;
  try {
    if (!(await isHealthy(controlApiUrl))) {
      vps = startService("node", ["apps/vps-control-api/dist/server.js"], {
        AO_CONTROL_API_SERVICE_TOKEN: process.env.AO_CONTROL_API_SERVICE_TOKEN ?? "dev-secret",
        HOST: host,
        PORT: controlPort
      });
      startedVps = true;
      await waitForHealth(controlApiUrl);
    }

    if (!(await isHealthy(daemonApiUrl))) {
      daemon = startService("node", ["apps/local-daemon/dist/server.js"], {
        AO_CONTROL_API_URL: controlApiUrl,
        AO_CONTROL_API_SERVICE_TOKEN: process.env.AO_CONTROL_API_SERVICE_TOKEN ?? "dev-secret",
        AO_DAEMON_HOST: process.env.AO_DAEMON_HOST ?? "127.0.0.1",
        AO_DAEMON_PORT: process.env.AO_DAEMON_PORT ?? daemonPort
      });
      startedDaemon = true;
      await waitForHealth(daemonApiUrl);
    }

    const smoke = startService(pnpmCmd, ["smoke:scaffold"], {
      AO_CONTROL_API_SERVICE_TOKEN: process.env.AO_CONTROL_API_SERVICE_TOKEN ?? "dev-secret",
      AO_CONTROL_API_URL: controlApiUrl,
      AO_DAEMON_API_URL: daemonApiUrl
    });

    await new Promise((resolve, reject) => {
      smoke.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`smoke:scaffold exited with code ${code}`));
      });
      smoke.on("error", reject);
    });
  } finally {
    if (startedDaemon && daemon && !daemon.killed) daemon.kill("SIGTERM");
    if (startedVps && vps && !vps.killed) vps.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
