#!/usr/bin/env bash
# The first build's record-library.sh for this build's project (shop2) and private folder: tunnels to the laptop's
# local library and saves the project's whole record (../../shop/harness/record-library.ts).
# Usage: record-library.sh <label>  ->  ~/storytree-lanes/shop-parallel-private/library-<label>.json, counts on stdout.
set -euo pipefail
label="$1"; private="${SHOP_PRIVATE:-$HOME/storytree-lanes/shop-parallel-private}"; local_port=55434
here="$(cd "$(dirname "$0")" && pwd)"; root="$(git -C "$here" rev-parse --show-toplevel)"
mkdir -p "$private"
port=$(ssh -n winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-par\\pgport.ps1" | tr -d '\r')
ssh -N -o ExitOnForwardFailure=yes -L "$local_port:127.0.0.1:$port" winlap & tunnel=$!
trap 'kill $tunnel 2>/dev/null' EXIT
sleep 3
cd "$root" && node --import tsx packages/app-setup/evidence/shop/harness/record-library.ts --project shop2 --port "$local_port" --out "$private/library-$label.json"
