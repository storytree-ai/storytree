#!/bin/sh
# mkuser.sh <label> <bins>: a fresh user whose Codex is signed in and connected to storytree, and a fresh project folder.
set -e
U=/tmp/cxrepro/u-$1
rm -rf "$U"; mkdir -p "$U/.codex" "$U/.claude" "$U/.storytree" "$U/folder"
ln -s /tmp/cxrepro/home "$U/.storytree/0.3"
cp ~/.codex/auth.json "$U/.codex/"
printf 'model = "gpt-6-astra"\n' > "$U/.codex/config.toml"
export HOME="$U" CODEX_HOME="$U/.codex" CLAUDE_CONFIG_DIR="$U/.claude" STORYTREE_HOME=/tmp/cxrepro/home
cd "$U/folder"
node "$2/storytree.mjs" setup connect --codex 2>&1 | tail -5
node "$2/storytree.mjs" doctor --set-up "cx-$1" 2>&1 | tail -3
cd /home/mickh/code/storytree03 && node --import tsx /tmp/cxrepro/codexwire.mjs "$CODEX_HOME" "$2"
