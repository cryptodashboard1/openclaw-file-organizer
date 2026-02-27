#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_SYSTEMD_UNIT="${OPENCLAW_SYSTEMD_UNIT:-openclaw-proxy.service}"
AO_CONTROL_API_URL="${AO_CONTROL_API_URL:-http://127.0.0.1:4040}"
OPENCLAW_CONFIG="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1" >&2
    exit 1
  fi
}

need_cmd openclaw
need_cmd curl

echo "[1/5] control API health"
curl -fsS "${AO_CONTROL_API_URL}/health"
echo

echo "[2/5] plugin info"
openclaw plugins info auto-organizer

echo "[3/5] plugin doctor"
openclaw plugins doctor

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^${OPENCLAW_SYSTEMD_UNIT}"; then
  echo "[4/6] systemd runtime env"
  main_pid="$(systemctl show -p MainPID --value "${OPENCLAW_SYSTEMD_UNIT}")"
  if [[ "${main_pid}" == "0" ]] || [[ ! -r "/proc/${main_pid}/environ" ]]; then
    echo "unable to read runtime env for ${OPENCLAW_SYSTEMD_UNIT} (pid=${main_pid})" >&2
    exit 1
  fi
  tr '\0' '\n' <"/proc/${main_pid}/environ" | grep '^AO_CONTROL_API_'
else
  echo "[4/6] systemd runtime env skipped (unit not found: ${OPENCLAW_SYSTEMD_UNIT})"
fi

echo "[5/6] tool names check"
openclaw plugins info auto-organizer | grep "Tools: .*ao_list_devices"
openclaw plugins info auto-organizer | grep "ao_enqueue_cleanup_job"
openclaw plugins info auto-organizer | grep "ao_request_execute"

echo "[6/6] skill wiring check"
if [[ -f "$OPENCLAW_CONFIG" ]]; then
  grep -n '"auto-organizer"' "$OPENCLAW_CONFIG"
else
  echo "openclaw config not found at $OPENCLAW_CONFIG" >&2
  exit 1
fi

echo "verification passed"
