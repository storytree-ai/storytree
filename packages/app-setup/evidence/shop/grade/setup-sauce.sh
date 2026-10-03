#!/usr/bin/env bash
# Installs Swag Labs' official end-to-end suite, pinned, outside the repository (it installs beside itself).
# Usage: setup-sauce.sh [dir]  (default ~/storytree-lanes/shop-grade)
# The suite is run unmodified. The one environment change: chromedriver is installed at the local Chrome's
# major version (the pinned package.json asks for ^153; the grading box has Chrome 151), --no-save.
set -euo pipefail
dir="${1:-$HOME/storytree-lanes/shop-grade}"
pin=e0948dd03f0042ad24f5e9ca324657f13193c19f
mkdir -p "$dir"
if [ ! -d "$dir/sauce" ]; then git clone -q https://github.com/saucelabs/sample-app-web.git "$dir/sauce"; fi
git -C "$dir/sauce" fetch -q origin && git -C "$dir/sauce" checkout -q "$pin"
cd "$dir/sauce/test/e2e"
npm ci --no-audit --no-fund
major=$(google-chrome --version | grep -oE '[0-9]+' | head -1)
npm install --no-save --no-audit --no-fund "chromedriver@$major"
npm rebuild chromedriver
node_modules/chromedriver/lib/chromedriver/chromedriver --version
