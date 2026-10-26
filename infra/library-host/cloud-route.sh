#!/usr/bin/env bash
# The Mint box's side of the cloud sessions' HTTPS route to the library (ADR-1093 D3).
# Installs two systemd services and nothing else:
#   storytree-wsproxy     Neon's wsproxy (Postgres over WebSocket), listening only on 127.0.0.1:8080,
#                         allowed to reach only 127.0.0.1:5432, as an unprivileged (dynamic) user.
#   storytree-cloudflared cloudflared running the owner's remotely managed tunnel mint-library, whose
#                         public hostname (library.storytree.dev) Cloudflare routes to http://localhost:8080.
# The tunnel's token is read from a root-only file; it is never on a command line, in a unit file or printed.
# It changes nothing in pg_hba or Postgres: wsproxy arrives as a TCP client from 127.0.0.1, which the
# box's pg_hba already admits with a password (scram-sha-256). It refuses to run if that line is missing.
#
# Usage (on the Mint box):
#   bash cloud-route.sh --review                       report what is installed, listening and allowed; changes nothing
#   bash cloud-route.sh --dry-run                      print every change the real run would make; changes nothing
#   sudo bash cloud-route.sh [--install-token FILE]    the real run; FILE (optional) is moved into the token's place
set -euo pipefail

# --- Pins. Change a version only together with its hash, and have the script reviewed again. ---
CLOUDFLARED_VERSION=2026.10.2
CLOUDFLARED_URL=https://github.com/cloudflare/cloudflared/releases/download/$CLOUDFLARED_VERSION/cloudflared-linux-amd64.deb
CLOUDFLARED_SHA256=30a9a127c24ea8365fa8e11b13684128f34dd8a1137599aa00b4bebda1a0a083 # as published in the release notes
WSPROXY_COMMIT=99ed92dd75ba625d03c8d0bd1b09f8ccfe42916a # neondatabase/wsproxy master, 2024-11-04; it has no releases
WSPROXY_SRC_URL=https://github.com/neondatabase/wsproxy/archive/$WSPROXY_COMMIT.tar.gz
WSPROXY_SRC_SHA256=a3cb899deb2edab979d0ae6e95f57afe91743a56f16e234fc2ea62b0b4f53a5b
GO_VERSION=1.27.3
GO_URL=https://go.dev/dl/go$GO_VERSION.linux-amd64.tar.gz
GO_SHA256=65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40 # as published at go.dev/dl
# The build is reproducible (-trimpath, no cgo, no build id, modules checked against go.sum), so the binary
# it makes is pinned too: a build that differs is refused, not installed.
WSPROXY_BIN_SHA256=925836747660626ad9f5d4e4cd630699e8c559bb96b56fd80acc2b5ce9d5693b

# --- Where things go. ---
TOKEN_FILE=/etc/storytree/cloudflared-mint-library.token
WSPROXY_DIR=/usr/local/lib/storytree-wsproxy
WSPROXY_BIN=$WSPROXY_DIR/wsproxy-${WSPROXY_COMMIT:0:12}
UNIT_DIR=/etc/systemd/system
WSPROXY_UNIT=storytree-wsproxy.service
CLOUDFLARED_UNIT=storytree-cloudflared.service
WSPROXY_LISTEN=127.0.0.1:8080       # the tunnel's public hostname routes to http://localhost:8080
WSPROXY_METRICS=127.0.0.1:2112      # wsproxy's default is :2112 on every interface
CLOUDFLARED_METRICS=127.0.0.1:20241
POSTGRES_ADDR=127.0.0.1:5432
PUBLIC_HOST=library.storytree.dev   # the tunnel's public hostname, behind the Access application
ALLOW_ADDR_REGEX='^127[.]0[.]0[.]1:5432$' # bracketed dots: no backslashes for systemd to unescape

wsproxy_unit() {
  cat <<EOF
# Installed by infra/library-host/cloud-route.sh (ADR-1093 D3). Edit the script, not this file.
[Unit]
Description=storytree: Neon wsproxy, Postgres over WebSocket for the cloud sessions' tunnel
After=network.target postgresql.service

[Service]
ExecStart=$WSPROXY_BIN
Environment=LISTEN_PORT=$WSPROXY_LISTEN
Environment=PROMETHEUS_BIND=$WSPROXY_METRICS
Environment=ALLOW_ADDR_REGEX=$ALLOW_ADDR_REGEX
Environment=USE_HOST_HEADER=false
Environment=APPEND_PORT=
Environment=LOG_TRAFFIC=false
DynamicUser=yes
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
IPAddressDeny=any
IPAddressAllow=localhost
RestrictAddressFamilies=AF_INET AF_INET6
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
LockPersonality=yes
SystemCallArchitectures=native
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

cloudflared_unit() {
  cat <<EOF
# Installed by infra/library-host/cloud-route.sh (ADR-1093 D3). Edit the script, not this file.
[Unit]
Description=storytree: cloudflared running tunnel mint-library to wsproxy on $WSPROXY_LISTEN
After=network-online.target $WSPROXY_UNIT
Wants=network-online.target
BindsTo=$WSPROXY_UNIT

[Service]
LoadCredential=tunnel-token:$TOKEN_FILE
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel --management-diagnostics=false --metrics $CLOUDFLARED_METRICS run --token-file %d/tunnel-token
DynamicUser=yes
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
# The tunnel is configured from Cloudflare's dashboard; whatever it is pointed at, the box lets it reach
# loopback and the internet, never the LAN, the tailnet or link-local addresses.
IPAddressDeny=10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 fc00::/7 fe80::/10
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
LockPersonality=yes
SystemCallArchitectures=native
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

say() { printf '%s\n' "$*"; }
fail() { printf 'stopped: %s\n' "$*" >&2; exit 1; }
sha_of() { sha256sum "$1" | cut -d' ' -f1; }
installed_cloudflared() { { dpkg-query -W -f='${Status} ${Version}' cloudflared 2>/dev/null || true; } | sed -n 's/^install ok installed //p'; }
listeners_on() { ss -Hltn "sport = :${1##*:}" 2>/dev/null | awk '{print $4}' | sort -u | paste -sd' ' -; }
# The process ids holding a port (ss shows them only to root); empty when nothing listens or it cannot tell.
pids_on() { { ss -Hltnp "sport = :${1##*:}" 2>/dev/null || true; } | { grep -o 'pid=[0-9]*' || true; } | sed 's/pid=//' | sort -u | paste -sd' ' -; }

# Postgres's own rules, read as the owner over the local socket (peer auth). Prints the first line admitting
# 127.0.0.1 to every database with scram-sha-256, and only when no TCP rule covering 127.0.0.1 asks for less
# (Postgres uses the first rule that matches); empty when there is none, or Postgres could not be asked.
loopback_password_rule() {
  local q="with r as (select line_number, database, auth_method from pg_hba_file_rules
      where error is null and type in ('host', 'hostnossl')
        and case when address in ('all', 'samehost', 'samenet') then true
                 when address ~ '^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+\$' and netmask ~ '^[0-9.]+\$'
                   then (inet '127.0.0.1' & netmask::inet) = (address::inet & netmask::inet)
                 else false end)
    select min(line_number) filter (where auth_method = 'scram-sha-256' and 'all' = any(database)) from r
    having count(*) filter (where auth_method not in ('scram-sha-256', 'reject')) = 0"
  if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
    sudo -u "$SUDO_USER" psql -X -d postgres -tAc "$q" 2>/dev/null || true
  else
    psql -X -d postgres -tAc "$q" 2>/dev/null || true
  fi
}

token_state() {
  if [ ! -e "$TOKEN_FILE" ]; then echo missing; return; fi
  local st; st=$(stat -c '%F %U:%G %a %s' "$TOKEN_FILE")
  case $st in
    "regular file root:root 600 0") echo empty ;;
    "regular file root:root 600 "*) echo ok ;;
    *) echo "wrong ($st; it must be a regular file, root:root, mode 600)" ;;
  esac
}

# --- review: read-only ---
review() {
  local v pid user st
  say "== cloudflared"
  v=$(installed_cloudflared)
  if [ -z "$v" ]; then say "not installed (pinned: $CLOUDFLARED_VERSION)"
  elif [ "$v" = "$CLOUDFLARED_VERSION" ]; then say "installed $v, the pinned version"
  else say "installed $v, NOT the pinned $CLOUDFLARED_VERSION"; fi
  if [ -n "$v" ]; then
    st=$(dpkg --verify cloudflared 2>&1 || true)
    if [ -z "$st" ]; then say "its files match the package (dpkg --verify)"; else say "its files DIFFER from the package: $st"; fi
  fi
  say "== wsproxy"
  if [ ! -e "$WSPROXY_BIN" ]; then say "$WSPROXY_BIN is not installed"
  elif [ "$(sha_of "$WSPROXY_BIN")" = "$WSPROXY_BIN_SHA256" ]; then say "$WSPROXY_BIN matches the pinned build (commit ${WSPROXY_COMMIT:0:12})"
  else say "$WSPROXY_BIN does NOT match the pinned build's hash"; fi
  say "== tunnel token"
  say "$TOKEN_FILE: $(token_state) (its content is never read here)"
  for u in "$WSPROXY_UNIT" "$CLOUDFLARED_UNIT"; do
    say "== $u"
    if [ ! -e "$UNIT_DIR/$u" ]; then say "not installed"; continue; fi
    if [ "$u" = "$WSPROXY_UNIT" ]; then st=$(wsproxy_unit); else st=$(cloudflared_unit); fi
    if [ "$(cat "$UNIT_DIR/$u")" = "$st" ]; then say "unit file is the script's"; else say "unit file DIFFERS from the script's"; fi
    say "enabled: $(systemctl is-enabled "$u" 2>/dev/null || true); active: $(systemctl is-active "$u" 2>/dev/null || true)"
    pid=$(systemctl show -p MainPID --value "$u" 2>/dev/null || echo 0)
    if [ "${pid:-0}" != 0 ]; then user=$(ps -o user= -p "$pid" 2>/dev/null || true); say "runs as: ${user:-?} (pid $pid)"; fi
    systemctl show -p DynamicUser -p IPAddressAllow -p IPAddressDeny "$u" 2>/dev/null | sed 's/^/  /' || true
    if [ "$u" = "$WSPROXY_UNIT" ]; then
      systemctl show -p Environment --value "$u" 2>/dev/null | tr ' ' '\n' | grep -E '^(LISTEN_PORT|PROMETHEUS_BIND|ALLOW_ADDR_REGEX)=' | sed 's/^/  allowed: /' || true
    fi
  done
  say "== listening"
  for a in "$WSPROXY_LISTEN" "$WSPROXY_METRICS" "$CLOUDFLARED_METRICS"; do
    v=$(listeners_on "$a"); say "port ${a##*:}: ${v:-nothing}"
    case " $v " in *" 0.0.0.0:"*|*" *:"*|*" [::]:"*) say "  WARNING: port ${a##*:} listens beyond loopback" ;; esac
  done
  say "== what wsproxy lets through (probes from this machine)"
  if [ -n "$(listeners_on "$WSPROXY_LISTEN")" ]; then
    say "address=$POSTGRES_ADDR: $(curl -s --max-time 5 "http://$WSPROXY_LISTEN/v1?address=$POSTGRES_ADDR" | head -c 120 | tr -d '\n') (Bad Request means allowed: a plain request is not a WebSocket)"
    say "address=127.0.0.1:22: $(curl -s --max-time 5 "http://$WSPROXY_LISTEN/v1?address=127.0.0.1:22" | head -c 120 | tr -d '\n')"
  else
    say "wsproxy is not listening; nothing probed"
  fi
  say "== what the internet gets without Access's service token (one request to $PUBLIC_HOST)"
  st=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "https://$PUBLIC_HOST/v1?address=$POSTGRES_ADDR" || true)
  case $st in
    302|401|403) say "HTTP $st: Cloudflare Access turns it away before the tunnel" ;;
    000|"") say "no answer (the hostname does not resolve or the box cannot reach it)" ;;
    *) say "WARNING: HTTP $st, not Access's 302/401/403: wsproxy may be reachable with no service token" ;;
  esac
  say "== Postgres"
  v=$(loopback_password_rule)
  if [ -n "$v" ]; then say "pg_hba line $v admits 127.0.0.1 with a password (scram-sha-256): wsproxy needs nothing more"
  else say "could not find (or could not read) a pg_hba line admitting 127.0.0.1 with scram-sha-256"; fi
  say "== firewall"
  if command -v ufw >/dev/null 2>&1; then say "$(LC_ALL=C ufw status 2>/dev/null | head -1 || echo 'ufw status needs root')"; else say "ufw is not installed"; fi
  say "(review: nothing changed)"
}

# --- dry run and real run ---
DRY=0
TMP="" # the real run's scratch folder, removed when the script exits
run() { if [ $DRY -eq 1 ]; then say "would run: $*"; else "$@"; fi; }

write_unit() { # name, content
  local path=$UNIT_DIR/$1
  if [ -e "$path" ] && [ "$(cat "$path")" = "$2" ]; then say "$path is already the script's"; return 1; fi
  if [ $DRY -eq 1 ]; then
    if [ -e "$path" ]; then say "would replace $path (keeping it as $path.before-cloud-route), with:"; else say "would write $path:"; fi
    printf '%s\n' "$2" | sed 's/^/    /'
  else
    [ ! -e "$path" ] || cp -p "$path" "$path.before-cloud-route"
    printf '%s\n' "$2" > "$path.new"
    chmod 644 "$path.new"
    mv "$path.new" "$path"
    say "wrote $path"
  fi
  return 0
}

fetch_verified() { # url, sha256, destination
  curl -fsSL --proto '=https' --tlsv1.2 -o "$3" "$1"
  [ "$(sha_of "$3")" = "$2" ] || fail "$1 does not match its pinned SHA-256; nothing from it was used"
  say "downloaded and verified $(basename "$1")"
}

apply() {
  local install_token=$1 v pids unit ours changed_ws=0 changed_cf=0
  [ "$(dpkg --print-architecture)" = amd64 ] || fail "this script pins amd64 downloads"
  if [ $DRY -eq 0 ]; then
    [ "$(id -u)" -eq 0 ] || fail "the real run needs root: sudo bash $0"
    { [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; } || fail "run it with sudo from your own account (SUDO_USER is empty or root)"
  elif [ "$(id -u)" -ne 0 ]; then
    say "(dry run as $(id -un): the real run needs sudo)"
  fi

  say "== 1. Postgres: change nothing, but check wsproxy can reach it"
  [ -n "$(listeners_on "$POSTGRES_ADDR")" ] || fail "nothing listens on port 5432"
  v=$(loopback_password_rule)
  [ -n "$v" ] || fail "pg_hba does not admit 127.0.0.1 with scram-sha-256 alone (or Postgres could not be asked); this script does not change pg_hba"
  say "pg_hba line $v already admits 127.0.0.1 with a password: no change to pg_hba or Postgres"

  say "== 2. Ports 8080, 2112 and 20241 on loopback are free, or already ours"
  for a in "$WSPROXY_LISTEN" "$WSPROXY_METRICS" "$CLOUDFLARED_METRICS"; do
    v=$(listeners_on "$a")
    [ -z "$v" ] && continue
    pids=$(pids_on "$a")
    if [ "$a" = "$CLOUDFLARED_METRICS" ]; then unit=$CLOUDFLARED_UNIT; else unit=$WSPROXY_UNIT; fi
    ours=$(systemctl show -p MainPID --value "$unit" 2>/dev/null || true)
    if [ -n "$pids" ] && [ "$pids" = "$ours" ]; then say "port ${a##*:} is held by $unit already"
    elif [ $DRY -eq 1 ] && [ -z "$pids" ]; then say "port ${a##*:} is taken ($v); the real run checks that $unit holds it"
    else fail "port ${a##*:} is taken ($v) by ${pids:+process $pids}${pids:-a process this user cannot see}, not $unit"; fi
  done
  if [ -e "$UNIT_DIR/cloudflared.service" ]; then
    fail "$UNIT_DIR/cloudflared.service exists (from 'cloudflared service install'?); look at it before a second tunnel service is added"
  fi

  say "== 3. The tunnel's token: a root-only file, never printed"
  if [ -n "$install_token" ]; then
    # A regular file of the account that ran sudo, never a link; read and deleted as that account, so a
    # link swapped in afterwards reaches only what that account could reach anyway.
    { [ -f "$install_token" ] && [ ! -L "$install_token" ]; } || fail "--install-token $install_token is not a regular file (links are refused)"
    if [ $DRY -eq 1 ]; then
      say "would move $install_token to $TOKEN_FILE (root:root, mode 600), stripped of whitespace, and delete the original"
    else
      [ "$(stat -c %U "$install_token")" = "$SUDO_USER" ] || fail "$install_token is not owned by $SUDO_USER"
      install -d -m 755 -o root -g root "$(dirname "$TOKEN_FILE")"
      ( umask 077; sudo -u "$SUDO_USER" head -c 8192 -- "$install_token" | tr -d ' \t\r\n' > "$TOKEN_FILE.new" )
      grep -qE '^[A-Za-z0-9+/=_-]+$' "$TOKEN_FILE.new" || { rm -f "$TOKEN_FILE.new"; fail "$install_token does not look like a tunnel token (base64); not installed"; }
      chown root:root "$TOKEN_FILE.new"
      chmod 600 "$TOKEN_FILE.new"
      mv "$TOKEN_FILE.new" "$TOKEN_FILE"
      sudo -u "$SUDO_USER" rm -f -- "$install_token"
      changed_cf=1
      say "installed $TOKEN_FILE and deleted $install_token"
    fi
  else
    v=$(token_state)
    if [ "$v" = ok ]; then say "$TOKEN_FILE is in place (root:root, 600)"
    elif [ $DRY -eq 1 ]; then say "$TOKEN_FILE is $v: the real run will stop unless --install-token FILE is given"
    else fail "$TOKEN_FILE is $v; give --install-token FILE (see infra/library-host/README.md)"; fi
  fi

  if [ $DRY -eq 0 ]; then TMP=$(mktemp -d /root/cloud-route.XXXXXX); trap 'rm -rf "$TMP"' EXIT; fi

  say "== 4. cloudflared $CLOUDFLARED_VERSION, from Cloudflare's .deb, checked against its published SHA-256"
  v=$(installed_cloudflared)
  if [ "$v" = "$CLOUDFLARED_VERSION" ]; then
    say "cloudflared $v is already installed"
  elif [ $DRY -eq 1 ]; then
    say "would download $CLOUDFLARED_URL, check SHA-256 $CLOUDFLARED_SHA256, then dpkg -i it${v:+ (replacing the installed $v)}"
    say "  (its package script links /usr/local/bin/cloudflared and creates /usr/local/etc/cloudflared/)"
    changed_cf=1
  else
    fetch_verified "$CLOUDFLARED_URL" "$CLOUDFLARED_SHA256" "$TMP/cloudflared.deb"
    dpkg -i "$TMP/cloudflared.deb"
    changed_cf=1
  fi

  say "== 5. wsproxy at commit ${WSPROXY_COMMIT:0:12}, built from checked source with a checked Go $GO_VERSION"
  if [ -e "$WSPROXY_BIN" ] && [ "$(sha_of "$WSPROXY_BIN")" = "$WSPROXY_BIN_SHA256" ]; then
    say "$WSPROXY_BIN is already the pinned build"
  elif [ $DRY -eq 1 ]; then
    say "would download $GO_URL (SHA-256 $GO_SHA256) and $WSPROXY_SRC_URL (SHA-256 $WSPROXY_SRC_SHA256)"
    say "would build it in a scratch folder (modules checked against its go.sum), refuse it unless its SHA-256 is $WSPROXY_BIN_SHA256,"
    say "  then install it as $WSPROXY_BIN (root:root, 755) and delete the scratch folder, Go included"
    changed_ws=1
  else
    fetch_verified "$GO_URL" "$GO_SHA256" "$TMP/go.tar.gz"
    fetch_verified "$WSPROXY_SRC_URL" "$WSPROXY_SRC_SHA256" "$TMP/wsproxy.tar.gz"
    tar -xzf "$TMP/go.tar.gz" -C "$TMP"
    tar -xzf "$TMP/wsproxy.tar.gz" -C "$TMP"
    ( cd "$TMP/wsproxy-$WSPROXY_COMMIT" && env -i PATH="$TMP/go/bin:/usr/bin:/bin" HOME="$TMP/home" GOPATH="$TMP/gopath" \
        GOMODCACHE="$TMP/modcache" GOCACHE="$TMP/gocache" GOTOOLCHAIN=local GOFLAGS=-mod=readonly CGO_ENABLED=0 \
        GOOS=linux GOARCH=amd64 GOAMD64=v1 GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org \
        go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o "$TMP/wsproxy" . )
    [ "$(sha_of "$TMP/wsproxy")" = "$WSPROXY_BIN_SHA256" ] || fail "the built wsproxy does not match the pinned build's SHA-256; not installed"
    install -d -m 755 -o root -g root "$WSPROXY_DIR"
    install -m 755 -o root -g root "$TMP/wsproxy" "$WSPROXY_BIN"
    changed_ws=1
    say "installed $WSPROXY_BIN"
  fi

  say "== 6. The two services"
  write_unit "$WSPROXY_UNIT" "$(wsproxy_unit)" && changed_ws=1
  write_unit "$CLOUDFLARED_UNIT" "$(cloudflared_unit)" && changed_cf=1
  run systemctl daemon-reload
  run systemctl enable "$WSPROXY_UNIT" "$CLOUDFLARED_UNIT"
  if [ $changed_ws -eq 1 ]; then run systemctl restart "$WSPROXY_UNIT"; else run systemctl start "$WSPROXY_UNIT"; fi
  if [ $changed_cf -eq 1 ]; then run systemctl restart "$CLOUDFLARED_UNIT"; else run systemctl start "$CLOUDFLARED_UNIT"; fi

  say "== 7. Check"
  if [ $DRY -eq 1 ]; then say "(dry run: nothing changed)"; return; fi
  sleep 3
  systemctl is-active --quiet "$WSPROXY_UNIT" || fail "$WSPROXY_UNIT failed to start: journalctl -u $WSPROXY_UNIT"
  systemctl is-active --quiet "$CLOUDFLARED_UNIT" || fail "$CLOUDFLARED_UNIT failed to start: journalctl -u $CLOUDFLARED_UNIT"
  review
  say "done: the tunnel should now show as healthy in Cloudflare's dashboard (Zero Trust, Networks, Tunnels)."
}

main() {
  local mode=apply install_token=""
  while [ $# -gt 0 ]; do
    case $1 in
      --review) mode=review ;;
      --dry-run) DRY=1 ;;
      --install-token) [ $# -ge 2 ] || fail "--install-token needs a file"; case $2 in /*) install_token=$2 ;; *) install_token=$PWD/$2 ;; esac; shift ;;
      *) fail "unknown argument: $1 (usage: bash $0 --review | --dry-run [--install-token FILE] | sudo bash $0 [--install-token FILE])" ;;
    esac
    shift
  done
  cd /
  if [ "$mode" = review ]; then review; else apply "$install_token"; fi
}

# Sourcing the script (its test does) defines the functions and runs nothing.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
