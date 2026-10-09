#!/bin/sh
# storytree 0.3's one-line install on an Apple Silicon Mac, the twin of install.ps1:
#   curl -fsSL https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.sh | sh
# POSIX sh, also run under bash and zsh. Needs no Node, Homebrew, jq or checkout. Every step is a function and the
# last line runs them, so a download cut short runs nothing. Choose development with: | sh -s -- --channel development
# It is laid out by system and chip, so another system (the parked Linux arc) adds a branch, not a second script.

ST_REPO=storytree-ai/storytree
ST_MARKER="# storytree 0.3's command: added by its installer, taken out by storytree setup uninstall"
ST_LATER='Add a project later with Add project in the storytree app, storytree doctor --set-up <name> in a terminal in its folder, or by asking your agent there.'

# A step that fails says why in ST_ERROR and returns 1; the caller adds where it failed and how to retry.
st_fail() { ST_ERROR=$1; return 1; }

# st_platform SYSTEM CHIP: sets ST_SYSTEM and ST_ARCH, or says plainly why this machine is not one storytree installs on.
st_platform() {
  case "$1" in
    Darwin)
      case "$2" in
        arm64 | aarch64) ST_SYSTEM=darwin; ST_ARCH=arm64 ;;
        *) st_fail "storytree needs a Mac with Apple Silicon (M1 or later); this Mac has an $2 chip, which storytree does not support" ;;
      esac ;;
    Linux) st_fail "storytree does not install on Linux yet; it installs on Apple Silicon Macs and on Windows" ;;
    *) st_fail "This command installs storytree on an Apple Silicon Mac; this system is $1. On Windows, run the PowerShell command from storytree's release page" ;;
  esac
}

# st_json KEY < JSON: prints the value at a dotted key (array elements by index), or fails when it is absent.
st_json() {
  awk -v want="$1" '
    function emit(value,   d, at) {
      at = ""
      for (d = 1; d <= depth; d++) at = at (d > 1 ? "." : "") (kind[d] == "{" ? key[d] : index_[d])
      if (at == want && !found) { printf "%s", value; found = 1 }
    }
    { text = text $0 "\n" }
    END {
      n = length(text); i = 1; depth = 0; found = 0
      while (i <= n) {
        c = substr(text, i, 1)
        if (c == "{" || c == "[") { depth++; kind[depth] = c; index_[depth] = 0; expecting = (c == "{"); i++ }
        else if (c == "}" || c == "]") { depth--; i++ }
        else if (c == ",") { if (kind[depth] == "[") index_[depth]++; else expecting = 1; i++ }
        else if (c == ":") { expecting = 0; i++ }
        else if (c == "\"") {
          s = ""; i++
          while (i <= n) {
            c = substr(text, i, 1)
            if (c == "\\") {
              e = substr(text, i + 1, 1)
              s = s (e == "n" ? "\n" : e == "t" ? "\t" : e == "r" ? "\r" : e == "u" ? "\\u" : e); i += 2
            } else if (c == "\"") { i++; break }
            else { s = s c; i++ }
          }
          if (kind[depth] == "{" && expecting) key[depth] = s; else emit(s)
        }
        else if (c ~ /[ \t\r\n]/) i++
        else { j = i; while (j <= n && substr(text, j, 1) !~ /[],} \t\r\n]/) j++; emit(substr(text, i, j - i)); i = j }
      }
      exit !found
    }'
}

st_sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d ' ' -f 1; else sha256sum "$1" | cut -d ' ' -f 1; fi
}

st_verify() {
  [ "$(st_sha256 "$1" | tr 'A-F' 'a-f')" = "$(printf '%s' "$2" | tr 'A-F' 'a-f')" ] || st_fail 'the download checksum does not match the release; nothing was installed'
}

# st_install_dir HOME USERHOME: ~/Applications, unless this installation's own record names another folder.
st_install_dir() {
  ST_DIR="$2/Applications/storytree-0.3.app"
  [ -f "$1/delivery.json" ] || return 0
  st_record=$(st_json installDir < "$1/delivery.json")
  case "$(st_json schema < "$1/delivery.json")/$st_record" in
    1//*) ST_DIR=$st_record ;;
    *) st_fail 'Invalid delivery record. Keep it for diagnosis and check the installed app before retrying' ;;
  esac
}

# st_channel HOME INSTALLDIR REQUESTED: chooses the release channel without writing it, so a failed download can be retried.
st_channel() {
  case "$3" in "" | stable | development) ;; *) st_fail 'Choose a valid release channel: stable or development'; return ;; esac
  st_existing=
  if [ -f "$1/release-channel.json" ]; then
    st_existing=$(st_json channel < "$1/release-channel.json")
    case "$(st_json schema < "$1/release-channel.json")/$st_existing" in
      1/stable | 1/development) ;;
      *) st_fail "The saved release channel could not be read. Keep $1/release-channel.json for diagnosis; delivery will not replace it"; return ;;
    esac
    # With no app installed, the record is what a failed delivery left behind; an explicit choice replaces it.
    if [ ! -e "$2" ] && [ -n "$3" ]; then st_existing=; fi
  fi
  if [ -n "$st_existing" ] && [ -n "$3" ] && [ "$st_existing" != "$3" ]; then
    st_fail "This installation already uses $st_existing. Delivery cannot change its release channel to $3"; return
  fi
  ST_CHANNEL=${st_existing:-${3:-stable}}
}

st_save_channel() {
  mkdir -p "$1" && printf '{"schema":1,"channel":"%s"}' "$2" > "$1/release-channel.json"
}

st_fetch() {
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --user-agent storytree-delivery --output "$2" "$1"
}

st_download() {
  curl --fail --location --proto '=https' --tlsv1.2 --user-agent storytree-delivery --progress-bar --output "$2" "$1"
}

# st_release CHANNEL ARCH FILE: reads the channel's delivery manifest into FILE and sets ST_PAYLOAD_URL, _SHA and _NAME.
st_release() {
  st_pinned=
  if [ "$1" = stable ]; then
    st_fetch "https://raw.githubusercontent.com/$ST_REPO/release-channel-stable/latest.yml" "$3" || { st_fail 'the stable release pin could not be read'; return; }
    st_pinned=$(st_json version < "$3")
    case "$(st_json schema < "$3")/$(st_json channel < "$3")/$st_pinned" in
      1/stable/0.3.*) ;;
      *) st_fail 'The stable release pin is invalid. No development release was selected; retry after the stable pin is repaired'; return ;;
    esac
    case "${st_pinned#0.3.}" in 0 | [1-9] | [1-9]*[0-9]) ;; *) st_fail 'The stable release pin is invalid. No development release was selected; retry after the stable pin is repaired'; return ;; esac
    case "${st_pinned#0.3.}" in *[!0-9]*) st_fail 'The stable release pin is invalid. No development release was selected; retry after the stable pin is repaired'; return ;; esac
    st_manifest="https://github.com/$ST_REPO/releases/download/v$st_pinned/storytree-delivery.json"
  else
    st_manifest="https://github.com/$ST_REPO/releases/latest/download/storytree-delivery.json"
  fi
  st_fetch "$st_manifest" "$3" || { st_fail 'the release manifest could not be read'; return; }
  st_version=$(st_json version < "$3")
  case "$st_version" in [0-9]*.[0-9]*.[0-9]*) ;; *) st_fail 'the release manifest has no valid version'; return ;; esac
  if [ "$(st_json schema < "$3")" != 1 ] || { [ -n "$st_pinned" ] && [ "$st_version" != "$st_pinned" ]; }; then
    st_fail 'the release manifest version does not match the release'; return
  fi
  if [ "$1" = stable ] && [ "$(st_json channelSchema < "$3")" != 1 ]; then
    st_fail 'The pinned release cannot preserve the stable release channel'; return
  fi
  ST_PAYLOAD_NAME=$(st_json "macos.$2.name" < "$3")
  ST_PAYLOAD_SHA=$(st_json "macos.$2.sha256" < "$3")
  if [ "$ST_PAYLOAD_NAME" != "storytree-0.3-$st_version-mac-$2.zip" ]; then
    st_fail "release $st_version has no Mac app for $2"; return
  fi
  case "$ST_PAYLOAD_SHA" in
    *[!0-9a-fA-F]*) st_fail 'the release manifest has no valid checksum for the Mac app'; return ;;
  esac
  [ "${#ST_PAYLOAD_SHA}" -eq 64 ] || { st_fail 'the release manifest has no valid checksum for the Mac app'; return; }
  ST_PAYLOAD_URL="https://github.com/$ST_REPO/releases/download/v$st_version/$ST_PAYLOAD_NAME"
}

# st_profile_add FILE ENTRY: one marked PATH line for a login shell, written once; an older line of ours is replaced.
st_profile_add() {
  st_quoted=$(printf '%s' "$2" | sed 's/[\\"$`]/\\&/g')
  st_line="export PATH=\"$st_quoted:\$PATH\" $ST_MARKER"
  if [ -f "$1" ] && grep -qxF "$st_line" "$1"; then return 0; fi
  st_kept="$1.storytree-$$"
  if [ -f "$1" ]; then grep -vF "$ST_MARKER" "$1" > "$st_kept"; else : > "$st_kept"; fi
  printf '%s\n' "$st_line" >> "$st_kept" && cat "$st_kept" > "$1" && rm -f "$st_kept"
}

# The answer comes from the terminal: under curl | sh, standard input is the script itself.
st_ask() {
  printf '%s: ' "$1"
  if ST_ANSWER=$( (IFS= read -r st_line && printf '%s' "$st_line") 2>/dev/null < /dev/tty); then :; else ST_ANSWER=; ST_NO_TTY=1; echo; fi
}

st_delivery_steps() {
  ST_STEP=inspect
  st_op_probe "$1" "$2" || return
  if [ "$ST_PRESENT" = no ]; then
    ST_STEP=download; st_op_stage download; st_op_download "$2" || return
    st_op_persist || return
    ST_STEP=install; st_op_stage install; st_op_install "$ST_ARCHIVE" "$1" || return
    ST_STEP=verify; st_op_stage verify; st_op_probe "$1" "$2" || return
    [ "$ST_PRESENT" = yes ] || { st_fail 'the installed app or its tool payload is incomplete'; return; }
  else
    st_op_persist || return
  fi
  ST_STEP=finish; st_op_stage finish; st_op_finish "$1" "$2" || return
  ST_STEP=path; st_op_stage path; st_op_path
}

# st_delivery INSTALLDIR ARCH: install when nothing usable is there, then open the app and put the command on PATH.
st_delivery() {
  st_delivery_steps "$1" "$2" || st_fail "storytree delivery failed at $ST_STEP: $ST_ERROR. Retry: run the same command again. Your projects and agent settings have not been replaced"
}

st_connection() {
  echo 'Connect your installed and signed-in agents: 1 Claude Code, 2 Codex, 3 both, S skip for now.'
  st_ask 'Choose 1, 2, 3 or S'
  if [ -n "$ST_NO_TTY" ]; then
    echo 'No terminal to answer from, so no agent was connected. Later run storytree setup connect --claude or --codex (or both).'
    return 0
  fi
  case "$ST_ANSWER" in
    1) set -- --claude ;;
    2) set -- --codex ;;
    3) set -- --claude --codex ;;
    s | S) echo 'Skipped agent connection. Later run storytree setup connect --claude or --codex (or both).'; return 0 ;;
    *) st_fail 'Choose 1, 2, 3 or S. The app is installed; retry connection with storytree setup connect --claude or --codex (or both)'; return ;;
  esac
  st_op_connect "$@"
}

# st_project_folder HERE USERHOME: the folder step of ADR-0752 D1, as install.ps1 asks it.
st_project_folder() {
  # The home folder or the root as a project would put every folder under it in that project.
  st_offer=yes
  if [ -z "$1" ] || [ "${1%/}" = "${2%/}" ] || [ "$1" = / ]; then st_offer=; fi
  if [ -n "$st_offer" ]; then echo "Choose your project folder: press Enter for $1, type another folder (created if missing), or S to skip."
  else echo 'Choose your project folder: type its path (created if missing), or press Enter or S to skip.'; fi
  st_ask 'Project folder'
  if [ -n "$ST_NO_TTY" ] || [ "$ST_ANSWER" = s ] || [ "$ST_ANSWER" = S ] || { [ -z "$ST_ANSWER" ] && [ -z "$st_offer" ]; }; then
    echo "No project was set up. $ST_LATER"; return 0
  fi
  case "$ST_ANSWER" in
    "") st_folder=$1 ;;
    "~") st_folder=$2 ;;
    "~/"*) st_folder="$2/${ST_ANSWER#"~/"}" ;;
    /*) st_folder=$ST_ANSWER ;;
    *) st_folder="${1%/}/$ST_ANSWER" ;;
  esac
  st_status=$(st_op_inspect "$st_folder") || { st_fail "The project was not set up: the folder could not be read. The app and your agents are ready. $ST_LATER"; return; }
  if st_name=$(printf '%s' "$st_status" | st_json project); then
    echo "$st_folder is already storytree project '$st_name'. Nothing new was set up."; return 0
  fi
  st_suggestion=$(printf '%s' "$st_status" | st_json suggestion)
  while :; do
    echo "Project name: press Enter for '$st_suggestion', or type your own (lower-case letters, digits and single hyphens)."
    st_ask 'Project name'
    st_name=${ST_ANSWER:-$st_suggestion}
    st_result=$(st_op_setup "$st_folder" "$st_name") || { st_fail "The project was not set up: the library did not take it. The app and your agents are ready. $ST_LATER"; return; }
    [ "$(printf '%s' "$st_result" | st_json status)" = "name refused" ] || break
    printf '%s' "$st_result" | st_json message; echo
    st_suggestion=$(printf '%s' "$st_result" | st_json suggestion) || st_suggestion=$st_name
  done
  case "$(printf '%s' "$st_result" | st_json status)" in
    "already a project") echo "$st_folder is already storytree project '$(printf '%s' "$st_result" | st_json project)'. Nothing new was set up." ;;
    "folder refused") echo "$(printf '%s' "$st_result" | st_json message) No project was set up. $ST_LATER" ;;
    *) echo "$st_folder is now storytree project '$st_name', and the app shows it. Start Claude Code or Codex in that folder to work in it." ;;
  esac
}

# The operations the steps above take on the real machine; the tests replace them.
st_tools() { ST_NODE="$1/Contents/Resources/agent-tools/node"; ST_HELPER="$1/Contents/Resources/agent-tools/storytree-deliver.mjs"; }

st_op_stage() {
  case "$1" in
    download) echo 'Finding the storytree release for this installation channel.' ;;
    install) echo 'Installing the app into Applications in your home folder.' ;;
    verify) echo 'Checking the installed app and its bundled tools.' ;;
    finish) echo 'Opening the app and starting its database.' ;;
    path) echo 'Adding the storytree command to your PATH.' ;;
  esac
}

st_op_probe() {
  st_tools "$1"
  if [ ! -f "$ST_NODE" ] || [ ! -f "$ST_HELPER" ]; then
    if [ -e "$1" ]; then
      st_fail "The app at '$1' has no complete bundled tools. Delivery will not overwrite it: move it to the Bin (your projects and library are kept elsewhere), then retry"; return
    fi
    ST_PRESENT=no; return 0
  fi
  # An existing payload that no longer verifies is not permission to replace it silently.
  "$ST_NODE" "$ST_HELPER" inspect "$1" "$2" >/dev/null 2>&1 || {
    st_fail "The existing installation at '$1' failed verification. Open it to read its error, or move it to the Bin, then retry"; return
  }
  ST_PRESENT=yes
}

st_op_download() {
  st_release "$ST_CHANNEL" "$1" "$ST_TMP/storytree-delivery.json" || return
  echo "Downloading storytree $st_version for an Apple Silicon Mac."
  st_download "$ST_PAYLOAD_URL" "$ST_TMP/$ST_PAYLOAD_NAME" || { st_fail 'the download did not finish'; return; }
  st_verify "$ST_TMP/$ST_PAYLOAD_NAME" "$ST_PAYLOAD_SHA" || return
  ST_ARCHIVE="$ST_TMP/$ST_PAYLOAD_NAME"
}

st_op_persist() { st_save_channel "$ST_HOME" "$ST_CHANNEL" || st_fail "the release channel could not be saved in $ST_HOME"; }

st_op_install() {
  mkdir -p "$ST_TMP/app" || return
  # ditto keeps the bundle's signature and links as the release built them.
  if command -v ditto >/dev/null 2>&1; then ditto -x -k "$1" "$ST_TMP/app"; else unzip -q "$1" -d "$ST_TMP/app"; fi || { st_fail 'the downloaded app could not be unpacked'; return; }
  [ -d "$ST_TMP/app/storytree-0.3.app" ] || { st_fail 'the download holds no storytree-0.3.app'; return; }
  mkdir -p "$(dirname "$2")" && mv "$ST_TMP/app/storytree-0.3.app" "$2" || st_fail "the app could not be moved to $2"
}

st_op_finish() {
  st_tools "$1"
  ST_REPORT=$("$ST_NODE" "$ST_HELPER" finish "$1" "$2") || st_fail 'The app could not be opened or its database did not become ready. Read the app error above'
}

st_op_path() {
  [ "$(printf '%s' "$ST_REPORT" | st_json command.status)" != conflict ] || return 0
  st_profile_add "${ZDOTDIR:-$HOME}/.zprofile" "$(printf '%s' "$ST_REPORT" | st_json command.pathEntry)" || st_fail 'the storytree command could not be added to ~/.zprofile'
}

st_op_connect() {
  # The delivered command, run explicitly, even when an unrelated storytree is on PATH.
  "$(printf '%s' "$ST_REPORT" | st_json tools.node)" "$(printf '%s' "$ST_REPORT" | st_json tools.cli)" setup connect "$@" ||
    st_fail 'Agent connection needs attention; read each agent result above. The app remains installed. Retry with storytree setup connect --claude or --codex (or both)'
}

st_op_inspect() { "$(printf '%s' "$ST_REPORT" | st_json tools.node)" "$(printf '%s' "$ST_REPORT" | st_json tools.deliver)" project "$1"; }
st_op_setup() { "$(printf '%s' "$ST_REPORT" | st_json tools.node)" "$(printf '%s' "$ST_REPORT" | st_json tools.deliver)" add-project "$1" "$2"; }

st_main() {
  st_requested=
  while [ $# -gt 0 ]; do
    case "$1" in
      --channel) st_requested=${2:-}; shift ;;
      --channel=*) st_requested=${1#--channel=} ;;
      *) st_fail "unknown option $1; the only option is --channel stable|development"; return ;;
    esac
    shift
  done
  st_system=$(uname -s); st_chip=$(uname -m)
  # A terminal running under Rosetta reports an Intel chip on an Apple Silicon Mac.
  if [ "$st_system" = Darwin ] && [ "$st_chip" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then st_chip=arm64; fi
  st_platform "$st_system" "$st_chip" || return
  ST_HOME=${STORYTREE_HOME:-$HOME/.storytree/0.3}
  st_install_dir "$ST_HOME" "$HOME" || return
  st_channel "$ST_HOME" "$ST_DIR" "$st_requested" || return
  ST_TMP=$(mktemp -d "${TMPDIR:-/tmp}/storytree-delivery.XXXXXX") || { st_fail 'no temporary folder could be made'; return; }
  trap 'rm -rf "$ST_TMP"' EXIT
  trap 'exit 130' INT TERM
  st_delivery "$ST_DIR" "$ST_ARCH" || return
  echo 'storytree is installed; its app is open and its database is ready.'
  if [ "$(printf '%s' "$ST_REPORT" | st_json command.status)" = conflict ]; then
    echo "An existing storytree command was preserved: $(printf '%s' "$ST_REPORT" | st_json command.conflict)"
    echo "Run this installation explicitly: '$(printf '%s' "$ST_REPORT" | st_json tools.node)' '$(printf '%s' "$ST_REPORT" | st_json tools.cli)'"
  else
    echo 'The storytree command is available in a new terminal window.'
  fi
  st_connection || return
  st_project_folder "$PWD" "$HOME"
}

if [ "${STORYTREE_INSTALL_LIBRARY:-}" != 1 ]; then
  st_main "$@" || { printf '%s.\n' "$ST_ERROR" >&2; exit 1; }
fi
