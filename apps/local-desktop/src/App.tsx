import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { daemonApi } from "./api";
import { daemonSidecarStatus, startDaemonSidecar, stopDaemonSidecar } from "./tauri-sidecar";
import type { DaemonSidecarStatus, Proposal, WatchedPath } from "./types";

type TabKey = "overview" | "runs" | "settings";
type DecisionState = Record<
  string,
  {
    decision: "approve" | "reject";
    editedPath?: string;
  }
>;

const DEFAULT_PAIR_LABEL =
  (import.meta.env.VITE_AO_DEFAULT_PAIR_LABEL as string | undefined)?.trim() ||
  "Local Worker";
const DEFAULT_CONTROL_API_URL =
  (import.meta.env.VITE_AO_DEFAULT_CONTROL_API_URL as string | undefined)?.trim() ||
  "http://127.0.0.1:4040";
const DEFAULT_SANDBOX_ROOT =
  (import.meta.env.VITE_AO_DEFAULT_SANDBOX_ROOT as string | undefined)?.trim() ||
  "C:\\Users\\me\\AutoOrganizer\\test";

function formatDate(input?: string) {
  if (!input) return "-";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return d.toLocaleString();
}

function errorText(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  return String(error);
}

function defaultDecision(proposal: Proposal): "approve" | "reject" {
  return proposal.actionType === "manual_review" ? "reject" : "approve";
}

async function waitForDaemonHealth(timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch("http://127.0.0.1:5050/health");
      if (response.ok) return true;
    } catch {
      // no-op
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export default function App() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [runStatusFilter, setRunStatusFilter] = useState<string>("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [pairLabel, setPairLabel] = useState(DEFAULT_PAIR_LABEL);
  const [enqueueDryRun, setEnqueueDryRun] = useState(true);
  const [maxFiles, setMaxFiles] = useState(200);
  const [newWatchPath, setNewWatchPath] = useState("");
  const [newWatchProtected, setNewWatchProtected] = useState(false);
  const [decisionState, setDecisionState] = useState<DecisionState>({});
  const [notice, setNotice] = useState<string>("");
  const [bootstrapUrl, setBootstrapUrl] = useState(DEFAULT_CONTROL_API_URL);
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [sandboxRoot, setSandboxRoot] = useState(DEFAULT_SANDBOX_ROOT);
  const [sidecar, setSidecar] = useState<DaemonSidecarStatus>({
    available: false,
    running: false
  });

  const runtimeQuery = useQuery({
    queryKey: ["runtime"],
    queryFn: daemonApi.getRuntimeStatus,
    refetchInterval: 3000
  });

  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap-status"],
    queryFn: daemonApi.getBootstrapStatus,
    refetchInterval: 5000
  });

  const deviceQuery = useQuery({
    queryKey: ["device"],
    queryFn: daemonApi.getDevice,
    refetchInterval: 3000
  });

  const metricsQuery = useQuery({
    queryKey: ["metrics"],
    queryFn: daemonApi.getMetrics,
    refetchInterval: 5000
  });

  const runsQuery = useQuery({
    queryKey: ["runs", runStatusFilter],
    queryFn: () =>
      daemonApi.listRuns({
        status: runStatusFilter || undefined,
        limit: 100,
        offset: 0
      }),
    refetchInterval: 3000
  });

  const runDetailsQuery = useQuery({
    queryKey: ["run-details", selectedRunId],
    queryFn: () => daemonApi.getRunDetails(selectedRunId!),
    enabled: Boolean(selectedRunId),
    refetchInterval: 3000
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: daemonApi.getSettings
  });

  const watchedPathsQuery = useQuery({
    queryKey: ["watched-paths"],
    queryFn: daemonApi.listWatchedPaths
  });

  useEffect(() => {
    if (!bootstrapQuery.data) return;
    setBootstrapUrl(bootstrapQuery.data.controlApiUrl ?? bootstrapUrl);
  }, [bootstrapQuery.data]);

  const selectedRunSummary = useMemo(
    () => runsQuery.data?.runs.find((r) => r.runSummary.runId === selectedRunId)?.runSummary,
    [runsQuery.data, selectedRunId]
  );

  useEffect(() => {
    const proposals = runDetailsQuery.data?.snapshot.proposals;
    if (!proposals) return;
    const next: DecisionState = {};
    for (const proposal of proposals) {
      next[proposal.proposalId] = {
        decision: defaultDecision(proposal),
        editedPath: typeof proposal.after.path === "string" ? proposal.after.path : undefined
      };
    }
    setDecisionState(next);
  }, [runDetailsQuery.data?.snapshot.runSummary.runId]);

  useEffect(() => {
    let cancelled = false;

    async function bootSidecar() {
      const started = await startDaemonSidecar();
      if (cancelled) return;
      setSidecar(started);

      if (started.available) {
        const healthy = await waitForDaemonHealth(15_000);
        if (!healthy) {
          setNotice("Daemon sidecar started but health endpoint is not ready.");
          return;
        }
        try {
          await daemonApi.startRuntime();
          setNotice("Local daemon and runtime connection started.");
        } catch (error) {
          setNotice(`Runtime start pending setup: ${errorText(error)}`);
        } finally {
          void queryClient.invalidateQueries({ queryKey: ["runtime"] });
          void queryClient.invalidateQueries({ queryKey: ["device"] });
          void queryClient.invalidateQueries({ queryKey: ["status"] });
        }
      }
    }

    void bootSidecar();

    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  useEffect(() => {
    const timer = setInterval(() => {
      void daemonSidecarStatus()
        .then((next) => setSidecar(next))
        .catch(() => {
          setSidecar((prev) => ({ ...prev, running: false }));
        });
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const pairMutation = useMutation({
    mutationFn: async () => {
      const started = await daemonApi.startPairing({ label: pairLabel, os: "windows" });
      return daemonApi.completePairing(started.pairingSessionId);
    },
    onSuccess: () => {
      setNotice("Pairing complete.");
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["device"] });
    }
  });

  const startRuntimeMutation = useMutation({
    mutationFn: () => daemonApi.startRuntime(),
    onSuccess: () => {
      setNotice("Runtime connection started.");
      void queryClient.invalidateQueries({ queryKey: ["runtime"] });
    }
  });

  const stopRuntimeMutation = useMutation({
    mutationFn: async () => {
      await daemonApi.stopRuntime();
      return stopDaemonSidecar();
    },
    onSuccess: () => {
      setNotice("Runtime connection stopped and daemon sidecar terminated.");
      void queryClient.invalidateQueries({ queryKey: ["runtime"] });
      setSidecar((prev) => ({ ...prev, running: false }));
    }
  });

  const bootstrapConfigureMutation = useMutation({
    mutationFn: () =>
      daemonApi.configureBootstrap({
        controlApiUrl: bootstrapUrl.trim(),
        serviceToken: bootstrapToken.trim()
      }),
    onSuccess: () => {
      setBootstrapToken("");
      setNotice("Bootstrap configuration saved.");
      void queryClient.invalidateQueries({ queryKey: ["bootstrap-status"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    }
  });

  const bootstrapResetMutation = useMutation({
    mutationFn: daemonApi.resetBootstrap,
    onSuccess: () => {
      setNotice("Bootstrap configuration reset.");
      void queryClient.invalidateQueries({ queryKey: ["bootstrap-status"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    }
  });

  const enqueueMutation = useMutation({
    mutationFn: () =>
      daemonApi.enqueueRun({
        dryRun: enqueueDryRun,
        pathKinds: ["custom"],
        maxFiles,
        allowedActions: ["rename", "move", "archive", "index_only"],
        actorId: "local-desktop"
      }),
    onSuccess: (result) => {
      setNotice(`Run enqueued: ${result.runId}`);
      setSelectedRunId(result.runId);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["metrics"] });
    }
  });

  const approveExecuteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRunId || !runDetailsQuery.data) {
        throw new Error("Select a run first.");
      }
      const approvals = runDetailsQuery.data.snapshot.proposals.map((proposal) => {
        const decision = decisionState[proposal.proposalId] ?? {
          decision: defaultDecision(proposal)
        };
        const editedAfter =
          decision.editedPath &&
          decision.editedPath !== String(proposal.after.path ?? "")
            ? { ...proposal.after, path: decision.editedPath }
            : undefined;
        return {
          proposalId: proposal.proposalId,
          decision: decision.decision,
          editedAfter
        };
      });
      return daemonApi.approveExecute(selectedRunId, {
        approvals,
        decidedBy: { actorId: "local-ui" }
      });
    },
    onSuccess: () => {
      setNotice("Approved and execution started.");
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["run-details", selectedRunId] });
      void queryClient.invalidateQueries({ queryKey: ["metrics"] });
    }
  });

  const rollbackMutation = useMutation({
    mutationFn: () => {
      if (!selectedRunId) throw new Error("Select a run first.");
      return daemonApi.rollbackRun(selectedRunId);
    },
    onSuccess: () => {
      setNotice("Rollback requested.");
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["run-details", selectedRunId] });
      void queryClient.invalidateQueries({ queryKey: ["metrics"] });
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (input: {
      organizedRootPath: string;
      archiveRootPath: string;
      duplicateReviewPath: string;
      dryRunDefault: boolean;
    }) => daemonApi.updateSettings(input),
    onSuccess: () => {
      setNotice("Settings updated.");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  });

  const addWatchPathMutation = useMutation({
    mutationFn: (input: { path: string; isProtected: boolean }) =>
      daemonApi.addWatchedPath({
        path: input.path,
        pathType: "custom",
        isEnabled: true,
        isProtected: input.isProtected,
        includeSubfolders: input.isProtected
      }),
    onSuccess: () => {
      setNewWatchPath("");
      setNotice("Watched path added.");
      void queryClient.invalidateQueries({ queryKey: ["watched-paths"] });
    }
  });

  const removeWatchPathMutation = useMutation({
    mutationFn: (id: string) => daemonApi.deleteWatchedPath(id),
    onSuccess: () => {
      setNotice("Watched path removed.");
      void queryClient.invalidateQueries({ queryKey: ["watched-paths"] });
    }
  });

  const applySandboxDefaultsMutation = useMutation({
    mutationFn: async () => {
      const root = sandboxRoot.trim().replace(/[\\\/]+$/, "");
      if (!root) {
        throw new Error("Sandbox root path is required.");
      }

      const organizedRootPath = `${root}\\Organized`;
      const archiveRootPath = `${organizedRootPath}\\Archives`;
      const duplicateReviewPath = `${organizedRootPath}\\Duplicate Review`;
      const protectedPath = `${root}\\DO_NOT_TOUCH`;

      await daemonApi.updateSettings({
        dryRunDefault: true,
        organizedRootPath,
        archiveRootPath,
        duplicateReviewPath
      });

      const existing = await daemonApi.listWatchedPaths();
      for (const watched of existing.watchedPaths) {
        await daemonApi.deleteWatchedPath(watched.id);
      }

      await daemonApi.addWatchedPath({
        path: root,
        pathType: "custom",
        isEnabled: true,
        isProtected: false,
        includeSubfolders: false
      });

      await daemonApi.addWatchedPath({
        path: protectedPath,
        pathType: "custom",
        isEnabled: true,
        isProtected: true,
        includeSubfolders: true
      });
    },
    onSuccess: () => {
      setNotice("Sandbox defaults applied.");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["watched-paths"] });
    }
  });

  const runs = runsQuery.data?.runs ?? [];
  const watchedPaths = watchedPathsQuery.data?.watchedPaths ?? [];

  const runtimeState = runtimeQuery.data?.state ?? "disconnected";
  const deviceState = deviceQuery.data?.paired ? "paired" : "unpaired";

  const allErrors =
    pairMutation.error ??
    startRuntimeMutation.error ??
    stopRuntimeMutation.error ??
    bootstrapConfigureMutation.error ??
    bootstrapResetMutation.error ??
    enqueueMutation.error ??
    approveExecuteMutation.error ??
    rollbackMutation.error ??
    updateSettingsMutation.error ??
    addWatchPathMutation.error ??
    removeWatchPathMutation.error ??
    applySandboxDefaultsMutation.error;

  const onBootstrapFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        controlApiUrl?: string;
        serviceToken?: string;
      };
      if (parsed.controlApiUrl) setBootstrapUrl(parsed.controlApiUrl);
      if (parsed.serviceToken) setBootstrapToken(parsed.serviceToken);
      setNotice("Bootstrap file loaded. Review values and save.");
    } catch (error) {
      setNotice(`Failed to parse bootstrap file: ${errorText(error)}`);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Auto-Organizer Local App</h1>
          <p>Local approvals and execution. OpenClaw orchestrates remotely.</p>
        </div>
        <div className="chip-group">
          <span className="chip">daemon: {sidecar.running ? "running" : "down"}</span>
          <span className="chip">connection: {runtimeState}</span>
          <span className="chip">device: {deviceState}</span>
          <span className="chip">
            heartbeat: {deviceQuery.data?.lastHeartbeatAt ? formatDate(deviceQuery.data.lastHeartbeatAt) : "not yet"}
          </span>
        </div>
      </header>

      {notice ? <div className="notice">{notice}</div> : null}
      {allErrors ? <div className="error">{errorText(allErrors)}</div> : null}

      <nav className="tabs">
        <button onClick={() => setActiveTab("overview")} className={activeTab === "overview" ? "active" : ""}>
          Overview
        </button>
        <button onClick={() => setActiveTab("runs")} className={activeTab === "runs" ? "active" : ""}>
          Runs
        </button>
        <button onClick={() => setActiveTab("settings")} className={activeTab === "settings" ? "active" : ""}>
          Settings
        </button>
      </nav>

      {activeTab === "overview" && (
        <section className="grid two-col">
          <article className="card">
            <h2>VPS Bootstrap</h2>
            <p className="muted small">
              Configure control API URL and token once. Stored locally with Windows DPAPI protection.
            </p>
            <div className="form-row">
              <label>Control API URL</label>
              <input value={bootstrapUrl} onChange={(e) => setBootstrapUrl(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Service token</label>
              <input
                type="password"
                value={bootstrapToken}
                onChange={(e) => setBootstrapToken(e.target.value)}
                placeholder="paste token from VPS bootstrap file"
              />
            </div>
            <div className="form-row">
              <label>Import bootstrap file</label>
              <input type="file" accept=".json" onChange={onBootstrapFileChange} />
            </div>
            <div className="row">
              <button
                onClick={() => bootstrapConfigureMutation.mutate()}
                disabled={bootstrapConfigureMutation.isPending || !bootstrapToken.trim()}
              >
                {bootstrapConfigureMutation.isPending ? "Saving..." : "Save Bootstrap"}
              </button>
              <button onClick={() => bootstrapResetMutation.mutate()} disabled={bootstrapResetMutation.isPending}>
                Reset Bootstrap
              </button>
            </div>
            <p className="muted small">
              source: {bootstrapQuery.data?.source ?? "none"} | configured:{" "}
              {bootstrapQuery.data?.configured ? "yes" : "no"}
            </p>
          </article>

          <article className="card">
            <h2>Connection Control</h2>
            <div className="form-row">
              <label>Device label</label>
              <input value={pairLabel} onChange={(e) => setPairLabel(e.target.value)} />
            </div>
            <div className="row">
              <button onClick={() => pairMutation.mutate()} disabled={pairMutation.isPending}>
                {pairMutation.isPending ? "Pairing..." : "Pair This Device"}
              </button>
              <button onClick={() => startRuntimeMutation.mutate()} disabled={startRuntimeMutation.isPending}>
                {startRuntimeMutation.isPending ? "Starting..." : "Start Connection"}
              </button>
              <button onClick={() => stopRuntimeMutation.mutate()} disabled={stopRuntimeMutation.isPending}>
                {stopRuntimeMutation.isPending ? "Stopping..." : "Stop Connection"}
              </button>
            </div>
            <p className="muted small">
              runtime: {runtimeQuery.data?.state ?? "-"} | poller:{" "}
              {runtimeQuery.data?.poller.stage ?? "-"}
            </p>
          </article>

          <article className="card">
            <h2>Quick Metrics</h2>
            <ul className="stat-list">
              <li>Total runs: {metricsQuery.data?.totals.allRuns ?? 0}</li>
              <li>Awaiting approval: {metricsQuery.data?.totals.awaitingApproval ?? 0}</li>
              <li>Completed: {metricsQuery.data?.totals.completed ?? 0}</li>
              <li>Failed: {metricsQuery.data?.totals.failed ?? 0}</li>
            </ul>
            {metricsQuery.data?.latestRun && (
              <p className="muted">
                Latest: {metricsQuery.data.latestRun.runId} ({metricsQuery.data.latestRun.status})
              </p>
            )}
          </article>

          <article className="card">
            <h2>Enqueue Run</h2>
            <div className="row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={enqueueDryRun}
                  onChange={(e) => setEnqueueDryRun(e.target.checked)}
                />
                Dry run
              </label>
              <label className="inline">
                Max files
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={maxFiles}
                  onChange={(e) => setMaxFiles(Number(e.target.value || "200"))}
                />
              </label>
            </div>
            <button onClick={() => enqueueMutation.mutate()} disabled={enqueueMutation.isPending}>
              {enqueueMutation.isPending ? "Submitting..." : "Start Cleanup Run"}
            </button>
          </article>
        </section>
      )}

      {activeTab === "runs" && (
        <section className="grid two-col">
          <article className="card">
            <div className="row between">
              <h2>Runs</h2>
              <select value={runStatusFilter} onChange={(e) => setRunStatusFilter(e.target.value)}>
                <option value="">All</option>
                <option value="awaiting_approval">awaiting_approval</option>
                <option value="completed">completed</option>
                <option value="failed">failed</option>
                <option value="running">running</option>
              </select>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th>Scanned</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.runSummary.runId}
                    className={selectedRunId === run.runSummary.runId ? "selected" : ""}
                    onClick={() => setSelectedRunId(run.runSummary.runId)}
                  >
                    <td>{run.runSummary.runId.slice(0, 18)}...</td>
                    <td>{run.runSummary.status}</td>
                    <td>{run.runSummary.dryRun ? "dry" : "live"}</td>
                    <td>{run.runSummary.filesScanned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="card">
            <div className="row between">
              <h2>Run Details</h2>
              <div className="row">
                <button
                  onClick={() => approveExecuteMutation.mutate()}
                  disabled={!selectedRunId || approveExecuteMutation.isPending}
                >
                  {approveExecuteMutation.isPending ? "Running..." : "Approve + Execute"}
                </button>
                <button
                  onClick={() => rollbackMutation.mutate()}
                  disabled={!selectedRunId || rollbackMutation.isPending}
                >
                  {rollbackMutation.isPending ? "Rolling back..." : "Rollback"}
                </button>
              </div>
            </div>

            {selectedRunSummary ? (
              <div className="summary-block">
                <div>Status: {selectedRunSummary.status}</div>
                <div>Dry run: {selectedRunSummary.dryRun ? "yes" : "no"}</div>
                <div>Scanned: {selectedRunSummary.filesScanned}</div>
                <div>Proposals: {selectedRunSummary.proposalsCreated}</div>
                <div>Executed: {selectedRunSummary.actionsExecuted}</div>
              </div>
            ) : (
              <p className="muted">Select a run to inspect.</p>
            )}

            {runDetailsQuery.data?.snapshot.proposals.map((proposal) => {
              const decision = decisionState[proposal.proposalId] ?? {
                decision: defaultDecision(proposal),
                editedPath: typeof proposal.after.path === "string" ? proposal.after.path : ""
              };
              return (
                <div key={proposal.proposalId} className="proposal-card">
                  <div className="row between">
                    <strong>{proposal.actionType}</strong>
                    <span className="chip">{proposal.riskLevel}</span>
                  </div>
                  <p>{proposal.reason}</p>
                  <p className="muted small">
                    {String(proposal.before.path ?? "")} -&gt; {String(proposal.after.path ?? "")}
                  </p>
                  <div className="row">
                    <select
                      value={decision.decision}
                      onChange={(e) =>
                        setDecisionState((prev) => ({
                          ...prev,
                          [proposal.proposalId]: {
                            ...prev[proposal.proposalId],
                            decision: e.target.value as "approve" | "reject"
                          }
                        }))
                      }
                    >
                      <option value="approve">approve</option>
                      <option value="reject">reject</option>
                    </select>
                    <input
                      value={decision.editedPath ?? ""}
                      onChange={(e) =>
                        setDecisionState((prev) => ({
                          ...prev,
                          [proposal.proposalId]: {
                            ...prev[proposal.proposalId],
                            editedPath: e.target.value
                          }
                        }))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </article>
        </section>
      )}

      {activeTab === "settings" && (
        <>
          <section className="card" style={{ marginBottom: "16px" }}>
            <h2>Quick Sandbox Setup</h2>
            <p className="muted small">
              One-click setup for test-only mode: sets roots under your sandbox and replaces watched paths with
              sandbox + protected subtree.
            </p>
            <div className="form-row">
              <label>Sandbox root path</label>
              <input value={sandboxRoot} onChange={(e) => setSandboxRoot(e.target.value)} />
            </div>
            <button
              onClick={() => applySandboxDefaultsMutation.mutate()}
              disabled={applySandboxDefaultsMutation.isPending}
            >
              {applySandboxDefaultsMutation.isPending ? "Applying..." : "Apply Sandbox Defaults"}
            </button>
          </section>

          <section className="grid two-col">
            <SettingsCard
              initialSettings={settingsQuery.data}
              isSaving={updateSettingsMutation.isPending}
              onSave={(payload) => updateSettingsMutation.mutate(payload)}
            />
            <WatchedPathCard
              watchedPaths={watchedPaths}
              newPath={newWatchPath}
              newPathProtected={newWatchProtected}
              onPathChange={setNewWatchPath}
              onProtectedChange={setNewWatchProtected}
              onAdd={() =>
                addWatchPathMutation.mutate({
                  path: newWatchPath,
                  isProtected: newWatchProtected
                })
              }
              onDelete={(id) => removeWatchPathMutation.mutate(id)}
            />
          </section>
        </>
      )}
    </div>
  );
}

function SettingsCard(props: {
  initialSettings:
    | {
        dryRunDefault: boolean;
        organizedRootPath: string;
        archiveRootPath: string;
        duplicateReviewPath: string;
      }
    | undefined;
  isSaving: boolean;
  onSave: (payload: {
    dryRunDefault: boolean;
    organizedRootPath: string;
    archiveRootPath: string;
    duplicateReviewPath: string;
  }) => void;
}) {
  const [dryRunDefault, setDryRunDefault] = useState(true);
  const [organizedRootPath, setOrganizedRootPath] = useState("");
  const [archiveRootPath, setArchiveRootPath] = useState("");
  const [duplicateReviewPath, setDuplicateReviewPath] = useState("");

  useEffect(() => {
    if (!props.initialSettings) return;
    setDryRunDefault(props.initialSettings.dryRunDefault);
    setOrganizedRootPath(props.initialSettings.organizedRootPath);
    setArchiveRootPath(props.initialSettings.archiveRootPath);
    setDuplicateReviewPath(props.initialSettings.duplicateReviewPath);
  }, [props.initialSettings]);

  return (
    <article className="card">
      <h2>Settings</h2>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={dryRunDefault}
          onChange={(e) => setDryRunDefault(e.target.checked)}
        />
        Dry run default
      </label>
      <div className="form-row">
        <label>Organized root</label>
        <input value={organizedRootPath} onChange={(e) => setOrganizedRootPath(e.target.value)} />
      </div>
      <div className="form-row">
        <label>Archive root</label>
        <input value={archiveRootPath} onChange={(e) => setArchiveRootPath(e.target.value)} />
      </div>
      <div className="form-row">
        <label>Duplicate review root</label>
        <input value={duplicateReviewPath} onChange={(e) => setDuplicateReviewPath(e.target.value)} />
      </div>
      <button
        onClick={() =>
          props.onSave({
            dryRunDefault,
            organizedRootPath,
            archiveRootPath,
            duplicateReviewPath
          })
        }
        disabled={props.isSaving}
      >
        {props.isSaving ? "Saving..." : "Save Settings"}
      </button>
    </article>
  );
}

function WatchedPathCard(props: {
  watchedPaths: WatchedPath[];
  newPath: string;
  newPathProtected: boolean;
  onPathChange: (path: string) => void;
  onProtectedChange: (value: boolean) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <article className="card">
      <h2>Watched Paths</h2>
      <div className="form-row">
        <label>Path</label>
        <input value={props.newPath} onChange={(e) => props.onPathChange(e.target.value)} />
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={props.newPathProtected}
          onChange={(e) => props.onProtectedChange(e.target.checked)}
        />
        Protected
      </label>
      <button onClick={props.onAdd} disabled={!props.newPath.trim()}>
        Add Path
      </button>

      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>Protected</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.watchedPaths.map((wp) => (
            <tr key={wp.id}>
              <td className="small">{wp.path}</td>
              <td>{wp.isProtected ? "yes" : "no"}</td>
              <td>
                <button className="danger" onClick={() => props.onDelete(wp.id)}>
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
