import type { DaemonSidecarStatus } from "./types";

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke: <T>(cmd: string, payload?: Record<string, unknown>) => Promise<T>;
  };
};

function tauriInvoke<T>(command: string, payload?: Record<string, unknown>) {
  const runtime = (window as TauriWindow).__TAURI_INTERNALS__;
  if (!runtime?.invoke) {
    return Promise.reject(new Error("not_tauri_runtime"));
  }
  return runtime.invoke<T>(command, payload);
}

function isTauriRuntime() {
  return Boolean((window as TauriWindow).__TAURI_INTERNALS__?.invoke);
}

export async function startDaemonSidecar(): Promise<DaemonSidecarStatus> {
  if (!isTauriRuntime()) {
    return { available: false, running: false, lastError: "not_tauri_runtime" };
  }
  return tauriInvoke<DaemonSidecarStatus>("start_daemon");
}

export async function stopDaemonSidecar(): Promise<DaemonSidecarStatus> {
  if (!isTauriRuntime()) {
    return { available: false, running: false, lastError: "not_tauri_runtime" };
  }
  return tauriInvoke<DaemonSidecarStatus>("stop_daemon");
}

export async function daemonSidecarStatus(): Promise<DaemonSidecarStatus> {
  if (!isTauriRuntime()) {
    return { available: false, running: false, lastError: "not_tauri_runtime" };
  }
  return tauriInvoke<DaemonSidecarStatus>("daemon_status");
}
