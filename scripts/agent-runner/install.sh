#!/usr/bin/env bash
# Install the assistant runner as a systemd user timer on this (always-on) desktop.
#   scripts/agent-runner/install.sh            install or update, start the timer
#   scripts/agent-runner/install.sh --remove   stop and remove the timer (keeps the clone and runs)
# The service runs scripts/agent_runner.mjs from THIS checkout, so keep it where it is
# (re-run the installer from a new checkout to point the service there).
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
conf_dir="${XDG_CONFIG_HOME:-$HOME/.config}/task-brain-agent"

if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now task-brain-agent.timer 2>/dev/null || true
  rm -f "$units/task-brain-agent.service" "$units/task-brain-agent.timer"
  systemctl --user daemon-reload
  echo "Removed the timer. Settings in $conf_dir and runs in ~/.local/share/task-brain-agent are kept."
  exit 0
fi

node_bin="$(command -v node || true)"
# fnm/nvm shells put node on a per-shell temp path; prefer a path that survives reboots.
[ -x /usr/bin/node ] && node_bin=/usr/bin/node
claude_bin="$(command -v claude || true)"
[ -n "$node_bin" ] || { echo "node not found"; exit 1; }
command -v gh >/dev/null || { echo "gh not found (the runner clones the data repo with it)"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first"; exit 1; }
if [ -n "$claude_bin" ]; then
  claude auth status 2>/dev/null | grep -q '"loggedIn": true' || echo "Note: claude is not logged in; Claude work will fail until you run 'claude' once and sign in."
else
  echo "Note: claude CLI not found; only Local (Ollama) work will run."
fi

mkdir -p "$units" "$conf_dir"
if [ ! -f "$conf_dir/env" ]; then
  cat > "$conf_dir/env" <<CONF
# task-brain assistant runner settings (see scripts/agent_runner.mjs)
TB_DATA_REPO=Rumi-Shamz/task-brain-data
TB_CLAUDE_MODEL=sonnet
TB_CLAUDE_BIN=${claude_bin:-claude}
TB_OLLAMA_MODEL=qwen2.5:7b
TB_MAX_RUNS=3
TB_TIMEOUT_MIN=20
CONF
  echo "Wrote $conf_dir/env"
fi

cat > "$units/task-brain-agent.service" <<UNIT
[Unit]
Description=task-brain assistant runner (one tick)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$repo
EnvironmentFile=$conf_dir/env
Environment=PATH=$(dirname "$node_bin"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$node_bin $repo/scripts/agent_runner.mjs
TimeoutStartSec=90min
Nice=10
UNIT

cat > "$units/task-brain-agent.timer" <<UNIT
[Unit]
Description=Run the task-brain assistant every 5 minutes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
OnActiveSec=10s

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now task-brain-agent.timer
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  echo "Tip: 'loginctl enable-linger $USER' keeps the timer running while you are logged out."
fi
echo "Installed. Runner code: $repo"
echo "  status:  systemctl --user list-timers task-brain-agent.timer"
echo "  logs:    journalctl --user -u task-brain-agent -f"
echo "  now:     systemctl --user start task-brain-agent"
