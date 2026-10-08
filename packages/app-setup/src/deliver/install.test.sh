# Get storytree 1.12: the macOS one-liner's steps, run under sh, bash and zsh by install-sh.test.ts.
STORYTREE_INSTALL_LIBRARY=1
. "$1"
fails=0
check() { if [ "$1" != "$2" ]; then printf 'FAIL %s: got [%s], wanted [%s]\n' "$3" "$1" "$2"; fails=$((fails + 1)); fi; }
refused() { # refused PATTERN MESSAGE COMMAND...: the command fails and names PATTERN
  pattern=$1; message=$2; shift 2
  ST_ERROR=
  if "$@"; then printf 'FAIL %s: accepted\n' "$message"; fails=$((fails + 1)); return; fi
  case "$ST_ERROR" in *$pattern*) ;; *) printf 'FAIL %s: said [%s]\n' "$message" "$ST_ERROR"; fails=$((fails + 1)) ;; esac
}
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT

# System and chip: only an Apple Silicon Mac goes on; anything else is told why, in plain words.
st_platform Darwin arm64; check "$ST_SYSTEM $ST_ARCH" "darwin arm64" "an Apple Silicon Mac is accepted"
refused "Apple Silicon" "an Intel Mac is refused" st_platform Darwin x86_64
refused "Linux" "Linux is not yet a branch" st_platform Linux x86_64
refused "PowerShell" "Windows is sent to its own command" st_platform MINGW64_NT-10.0 x86_64

# The JSON the release and the helper speak, read without jq or python.
json='{
  "schema": 1, "version": "0.3.123", "architectures": ["x64", "arm64"],
  "installer": { "name": "storytree-0.3-0.3.123-setup.exe", "sha256": "aa" },
  "macos": { "arm64": { "name": "storytree-0.3-0.3.123-mac-arm64.zip", "size": 12, "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
  "said": "a \"quoted\" word, a back\\slash and a , : { [ inside"
}'
check "$(printf '%s' "$json" | st_json macos.arm64.name)" "storytree-0.3-0.3.123-mac-arm64.zip" "a nested name"
check "$(printf '%s' "$json" | st_json installer.sha256)" "aa" "a sibling's same key stays its own"
check "$(printf '%s' "$json" | st_json schema)" "1" "a number"
check "$(printf '%s' "$json" | st_json architectures.1)" "arm64" "an array element"
check "$(printf '%s' "$json" | st_json said)" 'a "quoted" word, a back\slash and a , : { [ inside' "escapes and punctuation inside a string"
check "$(printf '{"command":{"status":"installed","pathEntry":"/Users/a b/.storytree/0.3/bin"},"tools":{"node":"/n"}}' | st_json command.pathEntry)" "/Users/a b/.storytree/0.3/bin" "the helper's compact report"
if printf '%s' "$json" | st_json macos.x64.name >/dev/null; then check present absent "a missing key fails"; fi

# Channel: stable by default, nothing written before a download, an installed app keeps its channel.
home="$root/home"; app="$root/Applications/storytree-0.3.app"
st_channel "$home" "$app" ""; check "$ST_CHANNEL" stable "a first install defaults to stable"
check "$(ls -A "$root")" "" "choosing a channel writes nothing"
st_save_channel "$home" stable
st_channel "$home" "$app" development; check "$ST_CHANNEL" development "an explicit retry replaces a failed download's leftover record"
mkdir -p "$app"
refused "already uses stable" "an installed app's channel is not silently changed" st_channel "$home" "$app" development
st_channel "$home" "$app" ""; check "$ST_CHANNEL" stable "a repeat keeps the installed channel"
printf '{broken' > "$home/release-channel.json"
refused "channel could not be read" "a damaged record stops delivery" st_channel "$home" "$app" ""
refused "valid release channel" "an unknown channel is refused" st_channel "$home" "$app" preview
rm -rf "$app" "$home"

# Installation folder: ~/Applications unless this installation's own record names another.
st_install_dir "$home" "$root"; check "$ST_DIR" "$root/Applications/storytree-0.3.app" "the default folder"
mkdir -p "$home"; printf '{"schema":1,"installDir":"/Volumes/Apps/storytree-0.3.app","tools":{}}' > "$home/delivery.json"
st_install_dir "$home" "$root"; check "$ST_DIR" "/Volumes/Apps/storytree-0.3.app" "the record's folder"
printf '{"schema":1,"installDir":"relative"}' > "$home/delivery.json"
refused "Invalid delivery record" "a record without an absolute folder" st_install_dir "$home" "$root"
rm -rf "$home"

# The release: the stable pin names the version; the manifest names the Mac app and its checksum.
st_fetch() { # st_fetch URL FILE: the network, replaced by files
  printf '%s\n' "$1" >> "$root/fetched"
  case "$1" in
    *release-channel-stable/latest.yml) printf '%s' "$pin" > "$2" ;;
    *storytree-delivery.json) printf '%s' "$manifest" > "$2" ;;
    *) return 1 ;;
  esac
}
pin='{"schema":1,"channel":"stable","version":"0.3.123"}'
manifest="$json"
manifest=$(printf '%s' "$json" | sed 's/"schema": 1,/"schema": 1, "channelSchema": 1,/')
st_release stable arm64 "$root/manifest.json"
check "$ST_PAYLOAD_URL" "https://github.com/storytree-ai/storytree/releases/download/v0.3.123/storytree-0.3-0.3.123-mac-arm64.zip" "stable takes the pinned release's Mac app"
check "$ST_PAYLOAD_SHA" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "and its checksum"
check "$(cat "$root/fetched")" "https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/latest.yml
https://github.com/storytree-ai/storytree/releases/download/v0.3.123/storytree-delivery.json" "stable reads the pin, then that release"
rm "$root/fetched"
st_release development arm64 "$root/manifest.json"
check "$(cat "$root/fetched")" "https://github.com/storytree-ai/storytree/releases/latest/download/storytree-delivery.json" "development reads the latest release"
pin='{"schema":1,"channel":"stable","version":"latest"}'
refused "stable release pin is invalid" "a bad pin never falls back to development" st_release stable arm64 "$root/manifest.json"
pin='{"schema":1,"channel":"stable","version":"0.3.124"}'
refused "does not match" "a release that is not the pinned one" st_release stable arm64 "$root/manifest.json"
manifest='{"schema":1,"channelSchema":1,"version":"0.3.123","installer":{"name":"storytree-0.3-0.3.123-setup.exe"}}'
refused "no Mac app" "a release without the Mac app" st_release development arm64 "$root/manifest.json"

# Checksum: a mismatch is refused and nothing is unpacked.
printf 'the app' > "$root/app.zip"
sum=$(st_sha256 "$root/app.zip")
check "${#sum}" 64 "a SHA-256 in hex"
st_verify "$root/app.zip" "$sum" || check refused accepted "a matching download"
refused "checksum does not match" "a damaged download" st_verify "$root/app.zip" "$(printf '%064d' 0)"

# PATH: one marked line in ~/.zprofile, written once, replacing an older one of ours, leaving the rest.
profile="$root/.zprofile"
printf 'export EDITOR=vim' > "$profile"
st_profile_add "$profile" "/Users/a b/.storytree/0.3/bin"
st_profile_add "$profile" "/Users/a b/.storytree/0.3/bin"
check "$(grep -cF .storytree/0.3 "$profile")" 1 "the line is written once"
check "$(head -n 1 "$profile")" "export EDITOR=vim" "the user's own lines stay"
check "$(PATH=/usr/bin; . "$profile"; printf '%s' "$PATH")" "/Users/a b/.storytree/0.3/bin:/usr/bin" "a login shell puts the command first on PATH"
st_profile_add "$profile" '/Users/$odd "one"/bin'
check "$(grep -cF .storytree/0.3 "$profile")" 0 "an older line of ours is replaced"
check "$(grep -c 'setup uninstall' "$profile")" 1 "the line is marked for setup uninstall"
check "$(PATH=/usr/bin; . "$profile"; printf '%s' "$PATH")" '/Users/$odd "one"/bin:/usr/bin' "a folder with shell characters stays one word"

# Delivery steps: download, install and verify only when nothing usable is there; a failure names its step.
steps=
present=no
st_op_stage() { :; }
st_op_probe() { ST_PRESENT=$present; steps="$steps probe"; }
st_op_download() { steps="$steps download"; ST_ARCHIVE="$root/app.zip"; }
st_op_persist() { steps="$steps persist"; }
st_op_install() { steps="$steps install"; present=yes; }
st_op_finish() { steps="$steps finish"; ST_REPORT='{"command":{"status":"installed"}}'; }
st_op_path() { steps="$steps path"; }
st_delivery "$app" arm64; check "$steps" " probe download persist install probe finish path" "a first install"
steps=; st_delivery "$app" arm64; check "$steps" " probe persist finish path" "a repeat reuses the installation"
st_op_install() { ST_ERROR="the app could not be moved into place"; return 1; }
present=no; steps=
refused "failed at install: the app could not be moved into place" "a failed install names its step" st_delivery "$app" arm64
case "$ST_ERROR" in *"run the same command again"*) ;; *) check "$ST_ERROR" "a retry action" "a failure says how to retry" ;; esac
check "$steps" " probe download persist" "nothing after the failed step runs"

# Connection: 1, 2, 3 or S, read from the terminal, since the script itself arrives on standard input.
answers=
st_ask() { ST_ANSWER=${answers%%|*}; answers=${answers#*|}; }
st_op_connect() { connected="$*"; }
for pair in "1|--claude" "2|--codex" "3|--claude --codex"; do
  answers="${pair%%|*}|"; connected=; st_connection >/dev/null; check "$connected" "${pair#*|}" "choice ${pair%%|*}"
done
answers="S|"; connected=none; st_connection >/dev/null; check "$connected" none "S skips"
answers="x|"; refused "Choose 1, 2, 3 or S" "an unknown choice" st_connection
ST_NO_TTY=1; connected=none; check "$(st_connection | tail -n 1)" "No terminal to answer from, so no agent was connected. Later run storytree setup connect --claude or --codex (or both)." "no terminal skips with a way back"
ST_NO_TTY=

# Project folder: Enter takes the folder it ran from, a typed path is resolved against it, a refused name is asked again.
st_op_inspect() { printf '{"suggestion":"my-app"}'; }
st_op_setup() {
  printf ' %s=%s' "$1" "$2" >> "$root/setup"
  if [ "$2" = Bad ]; then printf '{"status":"name refused","message":"Use lower-case letters.","suggestion":"bad"}'; else printf '{"status":"created","project":"%s"}' "$2"; fi
}
rm -f "$root/setup"; answers="||"; st_project_folder "$root/work" "$root" >/dev/null; check "$(cat "$root/setup" 2>/dev/null)" " $root/work=my-app" "Enter takes the folder and its suggested name"
rm -f "$root/setup"; answers="sub|Bad||"; st_project_folder "$root/work" "$root" >/dev/null; check "$(cat "$root/setup" 2>/dev/null)" " $root/work/sub=Bad $root/work/sub=bad" "a typed path and a re-asked name"
rm -f "$root/setup"; answers="|"; st_project_folder "$root" "$root" >/dev/null; check "$(cat "$root/setup" 2>/dev/null)" "" "from the home folder Enter skips"
rm -f "$root/setup"; answers="|"; st_project_folder / "$root" >/dev/null; check "$(cat "$root/setup" 2>/dev/null)" "" "from the root folder Enter skips"
rm -f "$root/setup"; answers="s|"; st_project_folder "$root/work" "$root" >/dev/null; check "$(cat "$root/setup" 2>/dev/null)" "" "S skips"
st_op_inspect() { printf '{"project":"already"}'; }
rm -f "$root/setup"; answers="|"; check "$(st_project_folder "$root/work" "$root")" "Choose your project folder: press Enter for $root/work, type another folder (created if missing), or S to skip.
$root/work is already storytree project 'already'. Nothing new was set up." "a folder already in a project is said"

if [ "$fails" -eq 0 ]; then echo "install.sh PASS"; else exit 1; fi
