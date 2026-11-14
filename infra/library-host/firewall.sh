#!/usr/bin/env bash
# The Mint box's firewall (arc "The Mint box runs behind its own firewall"): ufw, denying every incoming
# connection except SSH (22) and Postgres (5432) arriving over Tailscale, for IPv4 and IPv6 alike.
# Outgoing traffic, loopback (the cloud route's wsproxy and cloudflared, the box's own clients) and replies
# to the box's own connections are untouched: ufw allows them by default.
#
# Usage (on the Mint box):
#   bash firewall.sh --dry-run [--lan-ssh CIDR]   print every change the real run would make; changes nothing
#   sudo bash firewall.sh [--lan-ssh CIDR]        the real run; rerunning it changes nothing more
# --lan-ssh CIDR also lets SSH in from that home-network range (for example 192.168.1.0/24), as a way
# back in should Tailscale be down.
set -euo pipefail

UFW_DEFAULTS=/etc/default/ufw
TAILNET_IF=tailscale0
TAILNET_PORTS=(22 5432)

# The ufw commands that make the rule set, in order: the defaults, then the allows, then switching it on.
# The dry run prints exactly these; the real run runs exactly these. ufw skips a rule it already has.
planned_commands() {
  local lan=$1 port
  echo "ufw default deny incoming"
  echo "ufw default allow outgoing"
  for port in "${TAILNET_PORTS[@]}"; do
    echo "ufw allow in on $TAILNET_IF to any port $port proto tcp"
  done
  if [ -n "$lan" ]; then
    echo "ufw allow in from $lan to any port 22 proto tcp"
  fi
  echo "ufw --force enable"
}

main() {
  local dry=0 lan="" cmd
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      --lan-ssh) lan=${2:-}; shift ;;
      *) echo "firewall.sh: unknown argument: $1" >&2; return 2 ;;
    esac
    shift
  done
  if [ -n "$lan" ] && ! [[ $lan =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]]; then
    echo "firewall.sh: --lan-ssh wants an IPv4 range such as 192.168.1.0/24, not '$lan'" >&2
    return 2
  fi
  # Without the Tailscale interface the only way back in would be the LAN rule: refuse rather than lock the box.
  if ! ip link show "$TAILNET_IF" >/dev/null 2>&1; then
    echo "firewall.sh: no $TAILNET_IF interface; is Tailscale up? Nothing changed." >&2
    return 1
  fi
  if [ $dry = 0 ] && [ "$(id -u)" != 0 ]; then
    echo "firewall.sh: the real run needs root (sudo bash firewall.sh); try --dry-run first" >&2
    return 1
  fi

  if grep -qx 'IPV6=yes' "$UFW_DEFAULTS"; then
    echo "$UFW_DEFAULTS already has IPV6=yes"
  elif [ $dry = 1 ]; then
    echo "would set IPV6=yes in $UFW_DEFAULTS, so every rule covers IPv6 too"
  else
    if grep -q '^IPV6=' "$UFW_DEFAULTS"; then
      sed -i 's/^IPV6=.*/IPV6=yes/' "$UFW_DEFAULTS"
    else
      echo 'IPV6=yes' >>"$UFW_DEFAULTS"
    fi
    echo "set IPV6=yes in $UFW_DEFAULTS"
  fi

  while IFS= read -r cmd; do
    if [ $dry = 1 ]; then
      echo "would run: $cmd"
    else
      echo "running: $cmd"
      $cmd
    fi
  done < <(planned_commands "$lan")

  if [ $dry = 1 ]; then
    echo "(dry run: nothing changed)"
  else
    ufw status verbose
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
