#!/usr/bin/env bash
# Installs the stable routine on the Mint box: a checkout of its own kept at main (runner), and a systemd user timer
# that starts fortnight.sh every Monday at 09:00 local time; fortnight.sh acts only every 14 days. Like the box's lag
# timer (packages/dev-loop/src/lag-box.mjs), it needs Linger=yes. Usage: install-timer.sh [--dry-run]
set -euo pipefail
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
RUNNER=$HOME/storytree-lanes/stable-acceptance/runner
UNITS=$HOME/.config/systemd/user
PNPM=$(command -v pnpm); NODE_DIR=$(dirname "$(command -v node)")
[[ $(loginctl show-user "$USER" -p Linger) == Linger=yes ]] || { echo "Linger is off: the owner runs sudo loginctl enable-linger $USER"; exit 1; }
service="[Unit]
Description=Storytree: the fortnightly stable acceptance run on the old laptop (ADR-1032 D6)

[Service]
Type=oneshot
WorkingDirectory=$RUNNER
Environment=PATH=$NODE_DIR:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStartPre=/usr/bin/git -C $RUNNER fetch -q origin main
ExecStartPre=/usr/bin/git -C $RUNNER checkout -q --detach FETCH_HEAD
ExecStartPre=$PNPM install --frozen-lockfile
ExecStart=/bin/bash $RUNNER/packages/app-setup/evidence/stable-acceptance/harness/fortnight.sh
TimeoutStartSec=6h
StandardOutput=append:$HOME/storytree-lanes/stable-acceptance/timer.log
StandardError=append:$HOME/storytree-lanes/stable-acceptance/timer.log
"
timer="[Unit]
Description=Storytree: look every Monday whether the stable acceptance run is due

[Timer]
OnCalendar=Mon *-*-* 09:00:00
Persistent=true

[Install]
WantedBy=timers.target
"
if [[ ${1:-} == --dry-run ]]; then printf '%s\n---\n%s' "$service" "$timer"; exit 0; fi
mkdir -p "$UNITS" "$(dirname "$RUNNER")"
[[ -d $RUNNER ]] || git -C "$REPO" worktree add --detach "$RUNNER" origin/main
printf '%s' "$service" > "$UNITS/stable-acceptance.service"
printf '%s' "$timer" > "$UNITS/stable-acceptance.timer"
systemctl --user daemon-reload
systemctl --user enable --now stable-acceptance.timer
systemctl --user list-timers stable-acceptance.timer --no-pager
