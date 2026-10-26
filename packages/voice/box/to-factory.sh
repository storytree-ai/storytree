#!/usr/bin/env bash
# Switch the confined voice door on the Mint box to the voice plugin in the owner's factory repo
# (increment_5992ebab6ab4, contract 4.10), after confine.sh, without the door going dark:
#   1. a read-only deploy key that only the door's user holds, for HuaMick/storytree-factory (question_61f27c49f036: A);
#   2. the door's factory clone, in its storytree home's default factory folder, installed against its base copy;
#   3. the door's units run its code through a link the refresh points, first at the base copy's voice package, proved;
#   4. the part switch names the factory plugin in voice's place, the refresh points the link at it, proved; a door that
#      does not answer is switched back to the base copy at once.
# It deletes nothing: the units it replaces are kept in /etc/storytree-voice/units-before-factory.
#
# Usage, on the Mint box, from a checkout holding this script:
#   sudo bash packages/voice/box/to-factory.sh --dry-run   says what it would do, changes nothing
#   sudo bash packages/voice/box/to-factory.sh             does it; safe to run again
#   sudo bash packages/voice/box/to-factory.sh --back      switches the door back to the base copy's voice
set -euo pipefail
cd /

DRY=0
BACK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --back) BACK=1 ;;
    *) echo "unknown argument: $1 (usage: sudo bash $0 [--dry-run] [--back])"; exit 1 ;;
  esac
  shift
done
run() { if [ $DRY -eq 1 ]; then echo "would run: $*"; else "$@"; fi; }
say() { echo "$@"; }

[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo: sudo bash $0"; exit 1; }
OWNER=${SUDO_USER:-}
{ [ -n "$OWNER" ] && [ "$OWNER" != root ]; } || { echo "Run it with sudo from your own account (SUDO_USER is empty or root)."; exit 1; }
OWNER_HOME=$(getent passwd "$OWNER" | cut -d: -f6)

VOICE=storytree-voice
STATE=/var/lib/storytree-voice
REPO=$STATE/repo
ST_HOME=$STATE/storytree
FACTORY=$ST_HOME/your-factory
LINK=$STATE/voice
NODE_HOME=/opt/storytree-voice/node
NODE=$NODE_HOME/bin/node
ETC=/etc/storytree-voice
KEPT_UNITS=$ETC/units-before-factory
KEY=$STATE/.ssh/storytree-factory
FACTORY_ORIGIN=git@github.com:HuaMick/storytree-factory.git
UNITS="storytree-voice.service storytree-voice-refresh.service storytree-voice-refresh.timer storytree-voice-restart.path storytree-voice-restart.service"
as_voice() { runuser -u "$VOICE" -- env HOME="$STATE" STORYTREE_HOME="$ST_HOME" PATH="$NODE_HOME/bin:/usr/bin:/bin" "$@"; }
# voice-host from the code the link points at, else the base copy's (before step 3 makes the link).
voice_code() { if [ -e "$LINK/src/bins/voice-host.ts" ]; then echo "$LINK"; else echo "$REPO/packages/voice"; fi; }
voice_host() {
  local code; code=$(voice_code)
  (cd "$REPO" && as_voice "$NODE" --import "file://$code/node_modules/tsx/dist/loader.mjs" "$code/src/bins/voice-host.ts" "$@")
}
# The same, as root: only root may write the system units into /etc/systemd/system, as confine.sh does.
voice_host_root() {
  local code; code=$(voice_code)
  (cd "$REPO" && "$NODE" --import "file://$code/node_modules/tsx/dist/loader.mjs" "$code/src/bins/voice-host.ts" "$@")
}

# The door answers: 404 off its route, and its secret route is served (not 404, not a server error).
answers() {
  local token off on
  token=$(sed -n 's/^\(VOICE_TOKEN\|VOICE_SPIKE_TOKEN\)=//p' "$ETC/env" | head -1)
  off=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:8787/ || true)
  on=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"to-factory","version":"1"}}}' \
    "http://127.0.0.1:8787/mcp/$token" || true)
  say "the door answers $off off its route (expect 404) and $on on its secret route (expect neither 404 nor 5xx)"
  [ "$off" = 404 ] && [ "$on" != 404 ] && [ "$on" != 000 ] && [ "${on:0:1}" != 5 ]
}
# Wait for the door to come back after a restart, up to 30 seconds.
settled() { for _ in $(seq 1 15); do sleep 2; systemctl is-active --quiet storytree-voice && answers >/dev/null && break; done; answers; }
refresh_now() { systemctl start storytree-voice-refresh.service; sleep 1; }
points_at() { readlink -f "$LINK" 2>/dev/null || echo none; }

[ -d "$REPO/.git" ] || { echo "$REPO is missing: confine the door first (packages/voice/box/confine.sh)"; exit 1; }
grep -qs VOICE_DOOR_LINK "$REPO/packages/voice/src/host.ts" "$LINK/src/host.ts" \
  || { echo "the door's copy $REPO does not have the switch yet: wait for its refresh to take main (within 15 minutes), then run again"; exit 1; }

if [ $BACK -eq 1 ]; then
  echo "== Back to the base copy's voice"
  run voice_host part voice on
  [ $DRY -eq 1 ] && { echo "(dry run: nothing changed)"; exit 0; }
  refresh_now
  say "the door's code: $(points_at)"
  settled && echo "done: the door runs the base copy's voice" || { echo "the door does not answer: journalctl -u storytree-voice -n 50"; exit 1; }
  exit 0
fi

echo "== 1. A read-only deploy key for $FACTORY_ORIGIN, held only by $VOICE in $KEY"
if [ -s "$KEY" ]; then
  say "$KEY is there"
else
  run install -d -m 0700 -o "$VOICE" -g "$VOICE" "$STATE/.ssh"
  run as_voice ssh-keygen -q -t ed25519 -N "" -C "storytree voice door ($(hostname))" -f "$KEY"
fi
if [ $DRY -eq 1 ]; then
  echo "would write $STATE/.ssh/config (github.com through $KEY only) and add github.com's host keys to $STATE/.ssh/known_hosts"
else
  printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" > "$STATE/.ssh/config"
  chown "$VOICE:$VOICE" "$STATE/.ssh/config"; chmod 0600 "$STATE/.ssh/config"
  grep -qs '^github.com ' "$STATE/.ssh/known_hosts" || as_voice sh -c "ssh-keyscan -t ed25519,rsa,ecdsa github.com 2>/dev/null >> $STATE/.ssh/known_hosts"
fi
if [ $DRY -eq 0 ] && ! as_voice git ls-remote -q "$FACTORY_ORIGIN" main >/dev/null 2>&1; then
  install -m 0644 -o "$OWNER" "$KEY.pub" "$OWNER_HOME/storytree-factory-deploy-key.pub"
  echo
  echo "GitHub does not know the key yet. Add it once, read-only, then run this script again:"
  echo "  on github.com: HuaMick/storytree-factory > Settings > Deploy keys > Add deploy key,"
  echo "    title \"storytree voice door (Mint)\", the key below, and leave \"Allow write access\" unticked;"
  echo "  or here, as $OWNER: gh repo deploy-key add ~/storytree-factory-deploy-key.pub -R HuaMick/storytree-factory -t \"storytree voice door (Mint)\""
  echo
  cat "$KEY.pub"
  exit 2
fi
[ $DRY -eq 1 ] || say "the key reads $FACTORY_ORIGIN"

echo "== 2. The door's factory clone, $FACTORY, its storytree home's default factory folder"
if [ -d "$FACTORY/.git" ]; then
  say "$FACTORY is there; the door's refresh keeps it at main"
else
  run as_voice git clone -q --branch main "$FACTORY_ORIGIN" "$FACTORY"
fi
# The plugin reaches storytree's packages through this link (gitignored in the factory): the door's base copy.
run as_voice ln -sfn "$REPO" "$FACTORY/storytree"
if [ $DRY -eq 1 ]; then echo "would run, in $FACTORY as $VOICE: pnpm install --frozen-lockfile"; else (cd "$FACTORY" && as_voice pnpm install --frozen-lockfile); fi
[ $DRY -eq 1 ] || [ -e "$FACTORY/plugins/voice/src/bins/voice.ts" ] || { echo "$FACTORY has no plugins/voice: the factory's main does not hold the voice plugin yet"; exit 1; }

echo "== 3. The door's units run its code through $LINK, pointed first at the base copy's voice"
if [ $DRY -eq 0 ] && [ ! -d "$KEPT_UNITS" ]; then
  install -d -m 0700 "$KEPT_UNITS"
  for unit in $UNITS; do cp -p "/etc/systemd/system/$unit" "$KEPT_UNITS/"; done
  say "kept the units it replaces in $KEPT_UNITS"
fi
[ -L "$LINK" ] || run as_voice ln -sfn "$REPO/packages/voice" "$LINK"
if [ $DRY -eq 1 ]; then
  echo "would write the five units voice-host system-units writes into /etc/systemd/system, then restart the door"
else
  voice_host_root system-units
  systemctl daemon-reload
  systemctl restart storytree-voice.service
  if ! settled; then
    echo "the door does not answer through the link: putting the kept units back"
    cp -p "$KEPT_UNITS"/* /etc/systemd/system/
    systemctl daemon-reload
    systemctl restart storytree-voice.service
    settled && echo "the door runs as before; see why: journalctl -u storytree-voice -n 50" || echo "the door does not answer either way: journalctl -u storytree-voice -n 50"
    exit 1
  fi
fi

echo "== 4. The factory plugin voice stands in for the base copy's voice"
run voice_host part voice plugin voice
if [ $DRY -eq 1 ]; then
  echo "would run the door's refresh, which points $LINK at $FACTORY/plugins/voice and restarts the door"
  echo "(dry run: nothing changed)"
  exit 0
fi
refresh_now
say "the door's code: $(points_at)"
if [ "$(points_at)" != "$(readlink -f "$FACTORY/plugins/voice")" ] || ! settled; then
  echo "the plugin did not take the door's place: switching back to the base copy"
  voice_host part voice on
  refresh_now
  say "the door's code: $(points_at)"
  settled && echo "the door runs the base copy's voice again; see why: journalctl -u storytree-voice -n 50" || echo "the door does not answer: journalctl -u storytree-voice -n 50"
  exit 1
fi
echo
echo "done: the door runs the factory plugin $(points_at), and its refresh keeps $REPO and $FACTORY at main."
echo "switch back: sudo bash $0 --back   (the base copy's voice, while storytree still ships it)"
echo "put the old units back: sudo cp -p $KEPT_UNITS/* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart storytree-voice"
