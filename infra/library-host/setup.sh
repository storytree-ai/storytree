#!/usr/bin/env bash
# One-time setup of storytree's own library server on the Mint box (owner-directed 2026-10-06).
# Installs Postgres 16 as a system service that starts on boot, lets tailnet clients (the laptop,
# CI over Tailscale) sign in with a password, and makes the owner's Linux account a superuser over
# the local socket so lanes can create roles, databases and backups without sudo.
# It deletes nothing, and changes no existing database (there is none before it runs).
#
# Usage (on the Mint box):  sudo bash mint-postgres-setup.sh --dry-run   then   sudo bash mint-postgres-setup.sh
set -euo pipefail
cd /

[ $# -le 1 ] || { echo "usage: sudo bash $0 [--dry-run]"; exit 1; }
DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  "") ;;
  *) echo "unknown argument: $1 (usage: sudo bash $0 [--dry-run])"; exit 1 ;;
esac
run() { if [ $DRY -eq 1 ]; then echo "would run: $*"; else "$@"; fi; }

[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo: sudo bash $0 ${1:-}"; exit 1; }
OWNER=${SUDO_USER:-}
{ [ -n "$OWNER" ] && [ "$OWNER" != root ]; } || { echo "Run it with sudo from your own account (SUDO_USER is empty or root)."; exit 1; }
CONF=/etc/postgresql/16/main
DROPIN=$CONF/conf.d/storytree.conf
DROPIN_TEXT="# storytree's own library (owner-directed 2026-10-06)
listen_addresses = '*'"
HBA_MARK="# storytree: tailnet clients sign in with a password"
HBA_LINE="host    all    all    100.64.0.0/10    scram-sha-256"
UNIT=postgresql@16-main
CHANGED=0

echo "== 1. Install Postgres 16 (Ubuntu noble's package, which Mint 22.x uses)"
if [ "$(dpkg-query -W -f='${Status}' postgresql-16 2>/dev/null || true)" = "install ok installed" ]; then
  echo "postgresql-16 is already installed"
elif [ $DRY -eq 1 ]; then
  echo "would run: apt-get update && apt-get install -y postgresql-16; apt's simulation says:"
  apt-get install -s postgresql-16 | grep -E '^(Inst|Remv|Conf)' || true
  CHANGED=1
else
  apt-get update -q
  apt-get install -y -q postgresql-16
  CHANGED=1
fi

echo "== 2. Listen on every interface; pg_hba admits only this machine and the tailnet"
# '*' rather than the Tailscale address, so Postgres still starts when Tailscale comes up after it at boot.
# Connections from anywhere else find no pg_hba entry and are refused before any sign-in.
if [ -e "$DROPIN" ]; then
  if [ "$(cat "$DROPIN")" = "$DROPIN_TEXT" ]; then
    echo "$DROPIN is already in place"
  else
    echo "$DROPIN exists with other content; not touching it. Look at it, then rerun."; exit 1
  fi
elif [ $DRY -eq 1 ]; then
  echo "would write $DROPIN: listen_addresses = '*'"
  CHANGED=1
else
  [ -d "$CONF/conf.d" ] || { echo "$CONF/conf.d is missing: is the 16/main cluster there?"; exit 1; }
  printf "%s\n" "$DROPIN_TEXT" > "$DROPIN"
  CHANGED=1
fi
if [ $DRY -eq 1 ] && [ ! -e "$CONF/pg_hba.conf" ]; then
  echo "would append to $CONF/pg_hba.conf (after install): $HBA_LINE"
  CHANGED=1
elif grep -qF -- "$HBA_MARK" "$CONF/pg_hba.conf"; then
  echo "pg_hba.conf already has the tailnet line"
elif [ $DRY -eq 1 ]; then
  echo "would append to $CONF/pg_hba.conf: $HBA_LINE"
  CHANGED=1
else
  [ -e "$CONF/pg_hba.conf.before-storytree" ] || cp -p "$CONF/pg_hba.conf" "$CONF/pg_hba.conf.before-storytree"
  printf "\n%s\n%s\n" "$HBA_MARK" "$HBA_LINE" >> "$CONF/pg_hba.conf"
  CHANGED=1
fi

echo "== 3. Let the tailnet reach port 5432 if the firewall is on"
st=""
command -v ufw >/dev/null 2>&1 && st=$(LC_ALL=C ufw status 2>/dev/null || true)
case $st in
  "Status: active"*) run ufw allow in on tailscale0 to any port 5432 proto tcp ;;
  *) echo "ufw is off: 5432 is reachable from the LAN, and pg_hba refuses everything but this machine and 100.64.0.0/10" ;;
esac

echo "== 4. Start on boot; restart only if a setting changed"
run systemctl enable postgresql "$UNIT"
if [ $CHANGED -eq 1 ]; then
  run systemctl restart "$UNIT"
else
  echo "nothing changed: not restarting a running server"
fi
if [ $DRY -eq 0 ]; then
  systemctl is-active --quiet "$UNIT" || { echo "16/main failed to start: see journalctl -u $UNIT"; exit 1; }
fi

echo "== 5. $OWNER administers the server over the local socket (peer auth, no password)"
if [ $DRY -eq 1 ]; then
  echo "would create superuser role $OWNER unless it exists"
elif [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$OWNER'")" = 1 ]; then
  echo "role $OWNER already exists"
else
  sudo -u postgres createuser --superuser "$OWNER"
fi

echo "== 6. Check"
if [ $DRY -eq 1 ]; then
  echo "(dry run: nothing changed)"
else
  systemctl is-enabled "$UNIT"
  sudo -u postgres psql -tAc "SELECT 'version ' || current_setting('server_version') || ', listening on ' || current_setting('listen_addresses')"
  [ -n "$(ss -Hltn 'sport = :5432')" ] || { echo "Postgres is not listening on 5432"; exit 1; }
  sudo -u "$OWNER" psql -d postgres -tAc "SELECT 'role ' || current_user || ' is superuser: ' || rolsuper FROM pg_roles WHERE rolname = current_user"
  echo "done: Postgres 16 runs on boot and $OWNER is a superuser over the local socket."
  echo "No role has a password yet, so nothing can sign in over the network until the lane sets one (ALTER ROLE ... PASSWORD)."
fi
