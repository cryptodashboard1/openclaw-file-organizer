#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, State};

#[derive(Default)]
struct DaemonManager {
    child: Mutex<Option<Child>>,
    last_error: Mutex<Option<String>>,
    entry_path: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DaemonSidecarStatus {
    available: bool,
    running: bool,
    pid: Option<u32>,
    entry_path: Option<String>,
    last_error: Option<String>,
}

fn set_last_error(manager: &DaemonManager, error: Option<String>) {
    if let Ok(mut guard) = manager.last_error.lock() {
        *guard = error;
    }
}

fn get_last_error(manager: &DaemonManager) -> Option<String> {
    manager.last_error.lock().ok().and_then(|guard| guard.clone())
}

fn set_entry_path(manager: &DaemonManager, entry_path: Option<String>) {
    if let Ok(mut guard) = manager.entry_path.lock() {
        *guard = entry_path;
    }
}

fn get_entry_path(manager: &DaemonManager) -> Option<String> {
    manager.entry_path.lock().ok().and_then(|guard| guard.clone())
}

fn node_binary() -> String {
    env::var("AO_NODE_PATH").unwrap_or_else(|_| "node".to_string())
}

fn resolve_daemon_entry(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(custom) = env::var("AO_DAEMON_ENTRY") {
        let path = PathBuf::from(custom);
        if path.exists() {
            return Ok(path);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("local-daemon").join("dist").join("server.js"));
        candidates.push(resource_dir.join("dist").join("server.js"));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join("..").join("local-daemon").join("dist").join("server.js"));
        candidates.push(
            cwd.join("auto-organizer-agent")
                .join("apps")
                .join("local-daemon")
                .join("dist")
                .join("server.js"),
        );
        candidates.push(
            cwd.join("apps")
                .join("local-daemon")
                .join("dist")
                .join("server.js"),
        );
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(
                parent
                    .join("local-daemon")
                    .join("dist")
                    .join("server.js"),
            );
        }
    }

    if let Some(found) = candidates.into_iter().find(|candidate| candidate.exists()) {
        return Ok(found);
    }

    Err("Unable to resolve local-daemon entry. Set AO_DAEMON_ENTRY env var.".to_string())
}

fn post_runtime_stop() {
    let _ = ureq::post("http://127.0.0.1:5050/api/runtime/stop")
        .set("content-type", "application/json")
        .send_string("{}");
}

fn stop_child(manager: &DaemonManager) -> Result<(), String> {
    post_runtime_stop();
    let mut guard = manager
        .child
        .lock()
        .map_err(|_| "daemon lock poisoned".to_string())?;

    let Some(mut child) = guard.take() else {
        return Ok(());
    };

    let mut waited_ms = 0;
    while waited_ms < 20_000 {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {
                thread::sleep(Duration::from_millis(200));
                waited_ms += 200;
            }
            Err(error) => {
                return Err(format!("failed to query daemon process: {}", error));
            }
        }
    }

    if let Err(error) = child.kill() {
        return Err(format!("failed to terminate daemon process: {}", error));
    }
    let _ = child.wait();
    Ok(())
}

fn snapshot_status(manager: &DaemonManager) -> DaemonSidecarStatus {
    let mut running = false;
    let mut pid = None;

    if let Ok(mut guard) = manager.child.lock() {
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    *guard = None;
                }
                Ok(None) => {
                    running = true;
                    pid = Some(child.id());
                }
                Err(error) => {
                    set_last_error(manager, Some(format!("status_check_failed: {}", error)));
                }
            }
        }
    }

    DaemonSidecarStatus {
        available: true,
        running,
        pid,
        entry_path: get_entry_path(manager),
        last_error: get_last_error(manager),
    }
}

#[tauri::command]
fn daemon_status(state: State<DaemonManager>) -> DaemonSidecarStatus {
    snapshot_status(&state)
}

#[tauri::command]
fn start_daemon(app: AppHandle, state: State<DaemonManager>) -> Result<DaemonSidecarStatus, String> {
    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "daemon lock poisoned".to_string())?;
        if let Some(child) = guard.as_mut() {
            if child
                .try_wait()
                .map_err(|e| format!("failed to inspect daemon process: {}", e))?
                .is_none()
            {
                return Ok(snapshot_status(&state));
            }
            *guard = None;
        }
    }

    let daemon_entry = resolve_daemon_entry(&app)?;
    let mut cmd = Command::new(node_binary());
    cmd.arg(daemon_entry.as_os_str())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if env::var("AO_DAEMON_HOST").is_err() {
        cmd.env("AO_DAEMON_HOST", "127.0.0.1");
    }
    if env::var("AO_DAEMON_PORT").is_err() {
        cmd.env("AO_DAEMON_PORT", "5050");
    }

    for key in [
        "AO_CONTROL_API_URL",
        "AO_CONTROL_API_SERVICE_TOKEN",
        "AO_LOCAL_DB_PATH",
        "AO_BOOTSTRAP_CONFIG_PATH",
    ] {
        if let Ok(value) = env::var(key) {
            cmd.env(key, value);
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start local-daemon process: {}", e))?;

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "daemon lock poisoned".to_string())?;
        *guard = Some(child);
    }
    set_entry_path(&state, Some(daemon_entry.to_string_lossy().to_string()));
    set_last_error(&state, None);
    Ok(snapshot_status(&state))
}

#[tauri::command]
fn stop_daemon(state: State<DaemonManager>) -> Result<DaemonSidecarStatus, String> {
    if let Err(error) = stop_child(&state) {
        set_last_error(&state, Some(error.clone()));
        return Err(error);
    }
    Ok(snapshot_status(&state))
}

fn main() {
    let app = tauri::Builder::default()
        .manage(DaemonManager::default())
        .invoke_handler(tauri::generate_handler![start_daemon, stop_daemon, daemon_status])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
            let state = app_handle.state::<DaemonManager>();
            if let Err(error) = stop_child(&state) {
                set_last_error(&state, Some(error));
            }
        }
    });
}
