#!/usr/bin/env bash
# Confine the voice door on the Mint box (increment_c548b1e7c8fa, capability 4 of the voice story):
# move it off the owner's account, a Postgres superuser holding the GitHub and SSH keys, onto
#   - its own system user, storytree-voice, whose home is /var/lib/storytree-voice;
#   - its own node (/opt/storytree-voice/node) and its own repository copy (/var/lib/storytree-voice/repo),
#     cloned from GitHub with no credentials (the repository is public);
#   - its own database role, storytree_voice, signing in with a password over 127.0.0.1 only and
#     granted only the reads the door makes (role.sql and the *-grants.sql files beside this script);
#   - its own database, storytree-voice, holding the lock that turns voice writes off (door-database.sql);
#   - confined system units (voice-host system-units), replacing the owner's user units.
# The door's secret moves from the owner's ~/.config/storytree-voice-spike/env to /etc/storytree-voice/env.
# It deletes nothing: the owner's user units, copy and env file stay, for the rollback printed at the end.
#
# Usage, on the Mint box, from a checkout holding this script:
#   sudo bash packages/voice/box/confine.sh --dry-run     says what it would do, changes nothing
#   sudo bash packages/voice/box/confine.sh               does it; safe to run again
# Options: --node-dir <dir> (a Node 24 install to copy; default the newest v24 under the owner's nvm)
set -euo pipefail
cd /

DRY=0
NODE_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --node-dir) NODE_DIR="${2:-}"; shift ;;
    *) echo "unknown argument: $1 (usage: sudo bash $0 [--dry-run] [--node-dir <dir>])"; exit 1 ;;
  esac
  shift
done
run() { if [ $DRY -eq 1 ]; then echo "would run: $*"; else "$@"; fi; }
say() { echo "$@"; }

[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo: sudo bash $0"; exit 1; }
OWNER=${SUDO_USER:-}
{ [ -n "$OWNER" ] && [ "$OWNER" != root ]; } || { echo "Run it with sudo from your own account (SUDO_USER is empty or root)."; exit 1; }
OWNER_HOME=$(getent passwd "$OWNER" | cut -d: -f6)
OWNER_UID=$(id -u "$OWNER")
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

VOICE=storytree-voice
STATE=/var/lib/storytree-voice
REPO=$STATE/repo
ST_HOME=$STATE/storytree
NODE_HOME=/opt/storytree-voice/node
NODE=$NODE_HOME/bin/node
ETC=/etc/storytree-voice
ENV_FILE=$ETC/env
SPIKE_ENV=$OWNER_HOME/.config/storytree-voice-spike/env
ORIGIN=https://github.com/storytree-ai/storytree.git
CONF=/etc/postgresql/16/main
HBA=$CONF/pg_hba.conf
HBA_MARK="# storytree: the voice door's role signs in from this machine only, with its password (packages/voice/box/confine.sh)"
HBA_LINES="host    postgres,storytree_storytree,\"storytree-activity\",\"storytree-trunks\",\"storytree-voice\"    storytree_voice    127.0.0.1/32    scram-sha-256
host    all    storytree_voice    all    reject
local   all    storytree_voice           reject"
as_voice() { runuser -u "$VOICE" -- env HOME="$STATE" STORYTREE_HOME="$ST_HOME" PATH="$NODE_HOME/bin:/usr/bin:/bin" "$@"; }
as_postgres() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 "$@"; }
storytree_as_voice() { (cd "$REPO" && as_voice "$NODE" --import "file://$REPO/node_modules/tsx/dist/loader.mjs" "$REPO/packages/cli/src/bins/storytree.ts" "$@"); }

[ -r "$SPIKE_ENV" ] || { echo "$SPIKE_ENV is missing: it holds the door's secret and address settings"; exit 1; }
if [ -z "$NODE_DIR" ]; then
  NODE_DIR=$(ls -d "$OWNER_HOME"/.nvm/versions/node/v24.* 2>/dev/null | sort -V | tail -1 || true)
fi
{ [ -n "$NODE_DIR" ] && [ -x "$NODE_DIR/bin/node" ] && [ -e "$NODE_DIR/bin/pnpm" ]; } || { echo "no Node 24 install with pnpm found (looked under $OWNER_HOME/.nvm/versions/node); name one with --node-dir"; exit 1; }
systemctl is-active --quiet postgresql@16-main || { echo "postgresql@16-main is not running"; exit 1; }

echo "== 1. The door's own system user, $VOICE, at home in $STATE"
if id "$VOICE" >/dev/null 2>&1; then
  say "user $VOICE is there"
else
  run useradd --system --user-group --home-dir "$STATE" --shell /usr/sbin/nologin "$VOICE"
fi
run install -d -m 0750 -o "$VOICE" -g "$VOICE" "$STATE"
run install -d -m 0700 -o "$VOICE" -g "$VOICE" "$ST_HOME"

echo "== 2. Its own node, copied from $NODE_DIR to $NODE_HOME (the owner's sits under his home, which the door cannot see)"
if [ -x "$NODE" ] && [ "$("$NODE" -v)" = "$("$NODE_DIR/bin/node" -v)" ]; then
  say "$NODE is there at $("$NODE" -v)"
else
  run rm -rf "$NODE_HOME.new"
  run install -d -m 0755 /opt/storytree-voice
  run cp -a "$NODE_DIR" "$NODE_HOME.new"
  run chown -R root:root "$NODE_HOME.new"
  run rm -rf "$NODE_HOME"
  run mv "$NODE_HOME.new" "$NODE_HOME"
fi

echo "== 3. Its own repository copy, $REPO, cloned from $ORIGIN by $VOICE"
if [ -d "$REPO/.git" ]; then
  say "$REPO is there; its refresh timer keeps it at main"
else
  run as_voice git clone -q --branch main "$ORIGIN" "$REPO"
  if [ $DRY -eq 1 ]; then echo "would run, in $REPO as $VOICE: pnpm install --frozen-lockfile"; else (cd "$REPO" && as_voice pnpm install --frozen-lockfile); fi
fi

echo "== 4. Its storytree home, $ST_HOME: the library's address, the role's password, a machine id of its own, the search models"
if [ -s "$ST_HOME/auth.json" ]; then
  PASSWORD=$(sed -n 's/.*"key": *"\([0-9a-f]*\)".*/\1/p' "$ST_HOME/auth.json")
  [ -n "$PASSWORD" ] || { echo "$ST_HOME/auth.json holds no password this script wrote; move it aside and run again"; exit 1; }
  say "the role's password is kept in $ST_HOME/auth.json"
else
  PASSWORD=$(openssl rand -hex 32)
  if [ $DRY -eq 1 ]; then echo "would write $ST_HOME/auth.json (0600, $VOICE): a new password for storytree_voice"; else
    (umask 077; printf '{\n  "postgres": {\n    "key": "%s"\n  }\n}\n' "$PASSWORD" > "$ST_HOME/auth.json"); chown "$VOICE:$VOICE" "$ST_HOME/auth.json"
  fi
fi
SETTINGS='{"library":{"location":"postgres","address":"postgres://storytree_voice@127.0.0.1:5432/postgres"}}'
if [ $DRY -eq 1 ]; then echo "would write $ST_HOME/settings.json: $SETTINGS"; else
  printf '%s\n' "$SETTINGS" > "$ST_HOME/settings.json"; chown "$VOICE:$VOICE" "$ST_HOME/settings.json"; chmod 0600 "$ST_HOME/settings.json"
fi
HOST=$(hostname)
MACHINE_NAME="$HOST (voice door)"
if [ -s "$ST_HOME/machine.json" ]; then
  MACHINE=$(sed -n 's/.*"id": *"\([0-9a-f-]*\)".*/\1/p' "$ST_HOME/machine.json")
  say "its machine id is $MACHINE"
else
  MACHINE=$(cat /proc/sys/kernel/random/uuid)
  if [ $DRY -eq 1 ]; then echo "would write $ST_HOME/machine.json: id $MACHINE, name $MACHINE_NAME"; else
    printf '{\n  "id": "%s",\n  "name": "%s"\n}\n' "$MACHINE" "$MACHINE_NAME" > "$ST_HOME/machine.json"; chown "$VOICE:$VOICE" "$ST_HOME/machine.json"
  fi
fi
if [ -d "$ST_HOME/models" ]; then
  say "$ST_HOME/models is there"
elif [ -d "$OWNER_HOME/.storytree/0.3/models" ]; then
  run install -d -m 0700 -o "$VOICE" -g "$VOICE" "$ST_HOME/models"
  for model in "$OWNER_HOME"/.storytree/0.3/models/*/; do
    [ -d "$model" ] && run cp -a "$model" "$ST_HOME/models/"
  done
  run chown -R "$VOICE:$VOICE" "$ST_HOME/models"
else
  say "the owner has no search models to copy: the first meaning search downloads them"
fi

echo "== 5. Its database role, storytree_voice, its grants and its own database, as the superuser postgres"
if [ $DRY -eq 1 ]; then
  for f in role.sql library-grants.sql activity-grants.sql trunks-grants.sql door-database.sql trunk-approval.sql; do echo "would run $HERE/$f with psql"; done
else
  # The password goes in on standard input, never on a command line any account on the box can list.
  { printf "\\set password '%s'\n" "$PASSWORD"; cat "$HERE/role.sql"; } | as_postgres -d postgres
  as_postgres -d storytree_storytree < "$HERE/library-grants.sql"
  as_postgres -d storytree-activity < "$HERE/activity-grants.sql"
  as_postgres -d storytree-trunks < "$HERE/trunks-grants.sql"
  as_postgres -d storytree-voice < "$HERE/door-database.sql"
  as_postgres -d storytree-trunks -v machine="$MACHINE" -v machine_name="$MACHINE_NAME" -v folder="$REPO" < "$HERE/trunk-approval.sql"
fi

echo "== 6. pg_hba.conf: the role signs in over 127.0.0.1 with its password, and from nowhere else"
if grep -qF -- "$HBA_MARK" "$HBA"; then
  say "pg_hba.conf already has the voice door's lines"
elif [ $DRY -eq 1 ]; then
  echo "would put these lines before the first rule of $HBA (a rule higher up wins), then reload Postgres:"
  printf '%s\n' "$HBA_LINES"
else
  [ -e "$HBA.before-voice-door" ] || cp -p "$HBA" "$HBA.before-voice-door"
  first=$(grep -nE '^[[:space:]]*(local|host)' "$HBA" | head -1 | cut -d: -f1)
  [ -n "$first" ] || { echo "found no rule in $HBA to put the lines before"; exit 1; }
  { head -n $((first - 1)) "$HBA"; printf '%s\n%s\n\n' "$HBA_MARK" "$HBA_LINES"; tail -n +"$first" "$HBA"; } > "$HBA.new"
  chown --reference="$HBA" "$HBA.new"; chmod --reference="$HBA" "$HBA.new"
  mv "$HBA.new" "$HBA"
  systemctl reload postgresql@16-main
fi

echo "== 7. The door's own settings, from $SPIKE_ENV to $ENV_FILE (root only; systemd reads it)"
# Only the secret, PORT, ALLOWED_HOSTS and ALLOWED_CIDRS (contract 4.7): a path the spike's file carries, such as its
# REPO_DIR, would override the unit's own (EnvironmentFile= wins over Environment=) and point under a home ProtectHome hides.
run install -d -m 0700 -o root -g root "$ETC"
if [ $DRY -eq 1 ] && [ ! -d "$REPO/node_modules" ]; then
  say "would write $ENV_FILE with only $(grep -oE '^(VOICE_TOKEN|VOICE_SPIKE_TOKEN|PORT|ALLOWED_HOSTS|ALLOWED_CIDRS)=' "$SPIKE_ENV" | tr -d = | paste -sd, -) from $SPIKE_ENV"
else
  "$NODE" --import "file://$REPO/node_modules/tsx/dist/loader.mjs" "$REPO/packages/voice/src/bins/voice-host.ts" door-env --from "$SPIKE_ENV" --to "$ENV_FILE" $([ $DRY -eq 1 ] && echo --dry-run)
fi

echo "== 8. The confined system units, and the cut-over from the owner's user units"
if [ $DRY -eq 1 ] && [ ! -d "$REPO/node_modules" ]; then
  say "would write the five units voice-host system-units writes into /etc/systemd/system"
else
  run "$NODE" --import "file://$REPO/node_modules/tsx/dist/loader.mjs" "$REPO/packages/voice/src/bins/voice-host.ts" system-units $([ $DRY -eq 1 ] && echo --dry-run)
fi
run systemctl daemon-reload
user_units() { runuser -u "$OWNER" -- env XDG_RUNTIME_DIR="/run/user/$OWNER_UID" systemctl --user "$@"; }
# Both doors listen on 127.0.0.1:8787, so the old one stops before the new one starts; if the new one is not up and
# answering five seconds later, the old one is put back, so a failed cut-over never leaves the connector down.
run user_units disable --now storytree-voice.service storytree-voice-refresh.timer \
  || say "the owner's user units were not there to stop"
started=1
run systemctl enable --now storytree-voice-restart.path storytree-voice-refresh.timer storytree-voice.service || started=0

echo "== 9. Check"
if [ $DRY -eq 1 ]; then
  echo "(dry run: nothing changed)"
  exit 0
fi
sleep 5
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/ || true)
if [ $started -eq 0 ] || ! systemctl is-active --quiet storytree-voice || [ "$code" != 404 ]; then
  echo "storytree-voice did not start (it answered '$code' on 127.0.0.1:8787, expected 404): putting the owner's user units back"
  systemctl disable --now storytree-voice.service storytree-voice-refresh.timer storytree-voice-restart.path || true
  user_units enable --now storytree-voice.service storytree-voice-refresh.timer \
    && echo "the owner's door is running again; see why the confined one failed: journalctl -u storytree-voice -n 50" \
    || echo "the owner's user units did not start either: systemctl --user status storytree-voice"
  exit 1
fi
say "service: $(systemctl show -p User,ProtectHome,NoNewPrivileges,MemoryMax storytree-voice | tr '\n' ' ')"
say "the door answers on 127.0.0.1:8787 with a bare $code outside its secret route (expect 404)"
say "a read as $VOICE (question list):"
storytree_as_voice question list | head -5
say "the role's rights (expect reads t, writes f, lock_add t, lock_clear f, superuser f):"
as_postgres -d storytree_storytree -At -c "SELECT 'reads ' || (has_table_privilege('storytree_voice', 'record', 'SELECT') AND has_table_privilege('storytree_voice', 'record_event', 'SELECT')),
  'writes ' || (has_table_privilege('storytree_voice', 'record', 'INSERT, UPDATE, DELETE') OR has_table_privilege('storytree_voice', 'record_event', 'INSERT, UPDATE, DELETE') OR has_table_privilege('storytree_voice', 'feedback_screenshot', 'SELECT')),
  'superuser ' || (SELECT rolsuper FROM pg_roles WHERE rolname = 'storytree_voice')"
as_postgres -d storytree-voice -At -c "SELECT 'lock_add ' || has_table_privilege('storytree_voice', 'voice_lock', 'INSERT'), 'lock_clear ' || has_table_privilege('storytree_voice', 'voice_lock', 'UPDATE, DELETE')"
echo
echo "done: the door runs as $VOICE from $REPO, reading as storytree_voice."
echo "roll back: sudo systemctl disable --now storytree-voice storytree-voice-refresh.timer storytree-voice-restart.path"
echo "           then, as $OWNER: systemctl --user enable --now storytree-voice storytree-voice-refresh.timer"
echo "turn voice writes back on after lock_voice: psql -X -d storytree-voice -c 'DELETE FROM voice_lock'"
echo "cut the role off at once: sudo -u postgres psql -c 'ALTER ROLE storytree_voice NOLOGIN' -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'storytree_voice'\""
