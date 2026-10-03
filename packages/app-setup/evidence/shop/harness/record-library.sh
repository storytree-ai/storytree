#!/usr/bin/env bash
# Tunnels to the laptop's local library and saves the shop's library record (record-library.ts).
# Usage: record-library.sh <label>  ->  ~/storytree-lanes/shop-private/library-<label>.json, counts on stdout.
set -euo pipefail
label="$1"; private="${SHOP_PRIVATE:-$HOME/storytree-lanes/shop-private}"; local_port=55433
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
mkdir -p "$private"
scp -q "$(dirname "$0")/pgport.ps1" winlap:st-shop/pgport.ps1
port=$(ssh -n winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-shop\\pgport.ps1" | tr -d '\r')
ssh -N -o ExitOnForwardFailure=yes -L "$local_port:127.0.0.1:$port" winlap & tunnel=$!
trap 'kill $tunnel 2>/dev/null' EXIT
sleep 3
cd "$root" && node --import tsx packages/app-setup/evidence/shop/harness/record-library.ts --port "$local_port" --out "$private/library-$label.json"
