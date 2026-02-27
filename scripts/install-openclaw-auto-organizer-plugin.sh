#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR_DEFAULT="/opt/auto-organizer-agent/openclaw-plugin-auto-organizer"
PLUGIN_DIR="${1:-$PLUGIN_DIR_DEFAULT}"
OPENCLAW_ENV_FILE="${OPENCLAW_ENV_FILE:-$HOME/.openclaw/.env}"
AO_CONTROL_API_URL="${AO_CONTROL_API_URL:-http://127.0.0.1:4040}"
AO_CONTROL_API_TOKEN_FILE="${AO_CONTROL_API_TOKEN_FILE:-/etc/auto-organizer/control-api.token}"
OPENCLAW_SYSTEMD_UNIT="${OPENCLAW_SYSTEMD_UNIT:-openclaw-proxy.service}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1" >&2
    exit 1
  fi
}

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >>"$file"
  fi
}

wire_systemd_env() {
  local unit="$1"
  local base_url="$2"
  local token="$3"
  local dropin_dir="/etc/systemd/system/${unit}.d"
  local dropin_file="${dropin_dir}/auto-organizer.conf"

  mkdir -p "$dropin_dir"
  cat >"$dropin_file" <<EOF
[Service]
Environment=AO_CONTROL_API_URL=${base_url}
Environment=AO_CONTROL_API_SERVICE_TOKEN=${token}
EOF
}

require_cmd openclaw

if [[ ! -d "$PLUGIN_DIR" ]]; then
  echo "plugin directory not found: $PLUGIN_DIR" >&2
  exit 1
fi

if [[ ! -f "$PLUGIN_DIR/openclaw.plugin.json" ]]; then
  echo "manifest missing: $PLUGIN_DIR/openclaw.plugin.json" >&2
  exit 1
fi

if [[ ! -f "$AO_CONTROL_API_TOKEN_FILE" ]]; then
  echo "missing token file: $AO_CONTROL_API_TOKEN_FILE" >&2
  exit 1
fi

AO_TOKEN="$(cat "$AO_CONTROL_API_TOKEN_FILE")"
if [[ -z "$AO_TOKEN" ]]; then
  echo "empty service token in $AO_CONTROL_API_TOKEN_FILE" >&2
  exit 1
fi

echo "installing plugin from: $PLUGIN_DIR"
openclaw plugins install "$PLUGIN_DIR"
openclaw plugins enable auto-organizer

echo "updating openclaw env: $OPENCLAW_ENV_FILE"
upsert_env "$OPENCLAW_ENV_FILE" "AO_CONTROL_API_URL" "$AO_CONTROL_API_URL"
upsert_env "$OPENCLAW_ENV_FILE" "AO_CONTROL_API_SERVICE_TOKEN" "$AO_TOKEN"

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^${OPENCLAW_SYSTEMD_UNIT}"; then
  echo "wiring systemd environment for ${OPENCLAW_SYSTEMD_UNIT}"
  wire_systemd_env "$OPENCLAW_SYSTEMD_UNIT" "$AO_CONTROL_API_URL" "$AO_TOKEN"
  systemctl daemon-reload
  echo "restarting ${OPENCLAW_SYSTEMD_UNIT}"
  systemctl restart "$OPENCLAW_SYSTEMD_UNIT"
  systemctl status "$OPENCLAW_SYSTEMD_UNIT" --no-pager

  main_pid="$(systemctl show -p MainPID --value "$OPENCLAW_SYSTEMD_UNIT")"
  if [[ "${main_pid}" != "0" ]] && [[ -r "/proc/${main_pid}/environ" ]]; then
    echo "runtime env check (pid ${main_pid})"
    tr '\0' '\n' <"/proc/${main_pid}/environ" | grep '^AO_CONTROL_API_' || true
  fi
fi

echo "plugin verification"
openclaw plugins info auto-organizer
openclaw plugins doctor

echo "done"
