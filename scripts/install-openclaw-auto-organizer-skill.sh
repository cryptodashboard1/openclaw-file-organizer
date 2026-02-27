#!/usr/bin/env bash
set -euo pipefail

SKILL_SRC_DEFAULT="/opt/auto-organizer-agent/openclaw-skill-auto-organizer"
SKILL_SRC="${1:-$SKILL_SRC_DEFAULT}"
SKILL_ID="${SKILL_ID:-auto-organizer}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_CONFIG="${OPENCLAW_CONFIG:-$OPENCLAW_HOME/openclaw.json}"
SKILLS_DIR="${OPENCLAW_SKILLS_DIR:-$OPENCLAW_HOME/skills}"
SKILL_DEST="${SKILLS_DIR}/${SKILL_ID}"
OPENCLAW_SYSTEMD_UNIT="${OPENCLAW_SYSTEMD_UNIT:-openclaw-proxy.service}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1" >&2
    exit 1
  fi
}

require_cmd node

if [[ ! -d "$SKILL_SRC" ]]; then
  echo "skill source directory not found: $SKILL_SRC" >&2
  exit 1
fi

if [[ ! -f "$SKILL_SRC/SKILL.md" ]]; then
  echo "SKILL.md missing in $SKILL_SRC" >&2
  exit 1
fi

mkdir -p "$SKILLS_DIR"
rm -rf "$SKILL_DEST"
mkdir -p "$SKILL_DEST"
cp -R "$SKILL_SRC/." "$SKILL_DEST/"
touch "$SKILL_DEST/enabled"

echo "installed skill files to: $SKILL_DEST"

if [[ -f "$OPENCLAW_CONFIG" ]]; then
  node - "$OPENCLAW_CONFIG" "$SKILL_ID" "$SKILL_DEST" <<'NODE'
const fs = require("fs");
const [configPath, skillId, skillPath] = process.argv.slice(2);

const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw);
config.skills ??= {};
config.skills.entries ??= {};
const existing = config.skills.entries[skillId] ?? {};
config.skills.entries[skillId] = {
  ...existing,
  path: skillPath,
  enabled: true
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
NODE

  echo "updated skill entry in: $OPENCLAW_CONFIG"
else
  echo "openclaw config not found at $OPENCLAW_CONFIG; skipped config patch"
fi

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^${OPENCLAW_SYSTEMD_UNIT}"; then
  echo "restarting ${OPENCLAW_SYSTEMD_UNIT}"
  systemctl restart "$OPENCLAW_SYSTEMD_UNIT"
  systemctl status "$OPENCLAW_SYSTEMD_UNIT" --no-pager
fi

echo
echo "skill install complete."
echo "next check:"
echo "  grep -n '\"${SKILL_ID}\"' ${OPENCLAW_CONFIG}"
