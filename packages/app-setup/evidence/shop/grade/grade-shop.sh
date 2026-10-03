#!/usr/bin/env bash
# Grades one commit of the shop (the laptop agent's private GitHub repository) off the laptop, with Swag Labs'
# official suite, unmodified. Usage: grade-shop.sh <ref> <part> <out-prefix>
#   ref: a commit or branch of the shop repository; part: the part being graded (earlier parts are regressions)
# Needs setup-sauce.sh run once. Never edits the build: it clones a copy, installs and starts it as a user would.
set -uo pipefail
ref="$1"; part="$2"; out="$3"
grade="${SHOP_GRADE:-$HOME/storytree-lanes/shop-grade}"
repo="${SHOP_REPO:-HuaMick/shop}"
port="${SHOP_PORT:-3100}"
here="$(cd "$(dirname "$0")" && pwd)"
copy="$grade/build"
if [ ! -d "$grade/shop.git" ]; then gh repo clone "$repo" "$grade/shop.git" -- --mirror -q; fi
git -C "$grade/shop.git" fetch -q --prune origin '+refs/*:refs/*' 2>/dev/null || git -C "$grade/shop.git" remote update --prune >/dev/null
rm -rf "$copy" && git clone -q "$grade/shop.git" "$copy" && git -C "$copy" checkout -q "$ref" || exit 2
sha=$(git -C "$copy" rev-parse HEAD)
{ echo "ref $ref sha $sha part $part at $(date -Is)"; } > "$out.meta.txt"
(cd "$copy" && npm install --no-audit --no-fund > "$out.install.txt" 2>&1) || echo "npm install failed" >> "$out.meta.txt"
(cd "$copy" && PORT=$port npm start > "$out.server.txt" 2>&1 & echo $! > "$grade/server.pid")
for i in $(seq 1 60); do curl -s -o /dev/null "http://localhost:$port/" && break; sleep 1; done
curl -s -o /dev/null -w "server answered %{http_code} on / \n" "http://localhost:$port/" >> "$out.meta.txt"
(cd "$grade/sauce/test/e2e" && timeout 900 npx wdio test/configs/wdio.local.chrome.conf.ts --baseUrl "http://localhost:$port" > "$out.wdio.txt" 2>&1)
echo "wdio exit $?" >> "$out.meta.txt"
pkill -P "$(cat "$grade/server.pid")" 2>/dev/null; kill "$(cat "$grade/server.pid")" 2>/dev/null
fuser -k "$port/tcp" >/dev/null 2>&1 || true
node "$here/summarize.mjs" "$out.wdio.txt" "$part" | tee "$out.txt"
