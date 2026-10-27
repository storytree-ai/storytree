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
st_channel "$home" "$app" alpha; check "$ST_CHANNEL" alpha "an explicit retry replaces a failed download's leftover record"
mkdir -p "$app"
refused "already uses stable" "an installed app's channel is not silently changed" st_channel "$home" "$app" alpha
st_channel "$home" "$app" ""; check "$ST_CHANNEL" stable "a repeat keeps the installed channel"
# Alpha's old name, development, still reads and asks for alpha (ADR-1121).
printf '{"schema":1,"channel":"development"}' > "$home/release-channel.json"
st_channel "$home" "$app" ""; check "$ST_CHANNEL" alpha "a record saved as development is alpha"
st_channel "$home" "$app" development; check "$ST_CHANNEL" alpha "the old one-liner's --channel development asks for alpha"
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
# A release whose Mac build failed names the last good one, which is taken from its own release (4.6).
manifest='{"schema":1,"channelSchema":1,"version":"0.3.124","macos":{"arm64":{"name":"storytree-0.3-0.3.122-mac-arm64.zip","version":"0.3.122","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}}'
st_release development arm64 "$root/manifest.json"
check "$ST_PAYLOAD_URL" "https://github.com/storytree-ai/storytree/releases/download/v0.3.122/storytree-0.3-0.3.122-mac-arm64.zip" "a carried Mac build comes from its own release"
manifest='{"schema":1,"channelSchema":1,"version":"0.3.124","macos":{"arm64":{"name":"storytree-0.3-0.3.124-mac-arm64.zip","version":"0.3.123","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}}'
refused "no Mac app" "a carried entry whose app is not that build's" st_release development arm64 "$root/manifest.json"
manifest='{"schema":1,"channelSchema":1,"version":"0.3.124","macos":{"arm64":{"name":"storytree-0.3-latest-mac-arm64.zip","version":"latest","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}}'
refused "no valid Mac app build" "a carried entry that names no build" st_release development arm64 "$root/manifest.json"

# An acceptance run installs a named build as a stable user would get it, before the pin moves to it.
pin='{"schema":1,"channel":"stable","version":"0.3.100"}'
manifest=$(printf '%s' "$json" | sed 's/"schema": 1,/"schema": 1, "channelSchema": 1,/')
rm -f "$root/fetched"
STORYTREE_ACCEPTANCE_VERSION=0.3.123
st_release stable arm64 "$root/manifest.json"
check "$ST_PAYLOAD_URL" "https://github.com/storytree-ai/storytree/releases/download/v0.3.123/storytree-0.3-0.3.123-mac-arm64.zip" "an acceptance version takes that release's Mac app"
check "$(cat "$root/fetched")" "https://github.com/storytree-ai/storytree/releases/download/v0.3.123/storytree-delivery.json" "an acceptance version reads that release, not the pin"
refused "installs as stable" "an acceptance version on development" st_release development arm64 "$root/manifest.json"
STORYTREE_ACCEPTANCE_VERSION=latest
refused "0.3.<n>" "an acceptance version that names no release" st_release stable arm64 "$root/manifest.json"
STORYTREE_ACCEPTANCE_VERSION=0.3.124
refused "does not match" "an acceptance version whose release is another build" st_release stable arm64 "$root/manifest.json"
unset STORYTREE_ACCEPTANCE_VERSION

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

# Versions: a release replaces the installed app only when it is newer, compared part by part as numbers.
st_newer 0.3.711 0.3.1045 || check older newer "0.3.1045 is newer than 0.3.711"
if st_newer 0.3.1045 0.3.1045; then check newer same "the same version is not newer"; fi
if st_newer 0.3.1045 0.3.999; then check newer older "an older release is not newer"; fi
if st_newer "" 0.3.1045; then check newer unknown "an unreadable installed version is not replaced"; fi
mkdir -p "$root/Old.app/Contents"
printf '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>storytree-0.3</string>\n\t<key>CFBundleShortVersionString</key>\n\t<string>0.3.711</string>\n</dict>\n</plist>\n' > "$root/Old.app/Contents/Info.plist"
check "$(st_plist_version "$root/Old.app")" 0.3.711 "the installed version comes from the app's Info.plist"

# Replacing: the new app takes the old one's place, never lands inside it; a failed move puts the old one back.
mkdir -p "$root/New.app"; printf new > "$root/New.app/mark"
st_place "$root/New.app" "$root/Old.app" || check refused placed "the new app is placed over the old"
check "$(cat "$root/Old.app/mark" 2>/dev/null)/$(ls -A "$root" | grep -c storytree-old)" new/0 "the old app is gone and the new one is in its place"
mkdir -p "$root/Kept.app"; printf kept > "$root/Kept.app/mark"
refused "could not be moved" "a missing new app" st_place "$root/Missing.app" "$root/Kept.app"
check "$(cat "$root/Kept.app/mark")" kept "a failed move puts the old app back"
rm -rf "$root/Old.app" "$root/Kept.app"

# Signature: the Mac app is installed only when its signature is intact, its team is storytree's and Gatekeeper accepts
# it; any other app is refused and nothing is placed. macOS's tools are replaced by functions.
ditto() { mkdir -p "$4/storytree-0.3.app" && printf unpacked > "$4/storytree-0.3.app/mark"; }
codesign() {
  case "$1" in
    --verify) [ "$intact" = yes ] ;;
    -dv) printf 'Executable=%s\nTeamIdentifier=%s\n' "$2" "$team" >&2 ;;
  esac
}
spctl() { [ "$accepted" = yes ]; }
signed_install() { # signed_install INTACT TEAM ACCEPTED: runs the Mac install of a downloaded zip into a fresh folder
  intact=$1; team=$2; accepted=$3
  rm -rf "$root/tmp" "$root/Signed.app"; mkdir -p "$root/tmp"
  ST_SYSTEM=darwin; ST_TMP="$root/tmp"
  st_op_install "$root/app.zip" "$root/Signed.app"
}
signed_install yes YTUG339DCT yes || check "$ST_ERROR" installed "an app signed by storytree's team is installed"
check "$(cat "$root/Signed.app/mark" 2>/dev/null)" unpacked "and is placed"
refused "not signed by storytree" "an app signed by another team" signed_install yes ABCDE12345 yes
check "$(ls -A "$root" | grep -c Signed.app)" 0 "another team's app is not placed"
refused "not signed by storytree" "an app whose signature is broken" signed_install no YTUG339DCT yes
refused "nothing was installed" "an app Gatekeeper refuses" signed_install yes YTUG339DCT no
check "$(ls -A "$root" | grep -c Signed.app)" 0 "a refused app is not placed"
unset -f ditto codesign spctl
rm -rf "$root/tmp"

# Delivery steps: download, install and verify only when nothing usable is there or the channel has a newer
# release; a failure names its step.
steps=
present=no
installed=0.3.711
release=0.3.711
st_op_stage() { :; }
st_op_probe() { ST_PRESENT=$present; steps="$steps probe"; }
st_op_version() { ST_INSTALLED=$installed; steps="$steps version"; }
st_op_release() { steps="$steps release"; [ -n "$release" ] || { ST_ERROR='the release manifest could not be read'; return 1; }; st_version=$release; }
st_op_download() { steps="$steps download"; ST_ARCHIVE="$root/app.zip"; }
st_op_persist() { steps="$steps persist"; }
st_op_quit() { steps="$steps quit"; }
st_op_install() { steps="$steps install"; present=yes; }
st_op_finish() { steps="$steps finish"; ST_REPORT='{"command":{"status":"installed"}}'; }
st_op_path() { steps="$steps path"; }
st_delivery "$app" arm64 >/dev/null; check "$steps" " probe release download persist install probe finish path" "a first install"
steps=; said=$(st_delivery "$app" arm64; printf '|%s' "$steps"); check "$said" "| probe version release persist finish path" "a repeat on the channel's version changes nothing"
release=0.3.1045
steps=; said=$(st_delivery "$app" arm64; printf '|%s' "$steps"); check "$said" "Updating storytree 0.3.711 to 0.3.1045.
| probe version release download persist quit install probe finish path" "a repeat over an older version updates it"
release=
steps=; said=$(st_delivery "$app" arm64; printf '|%s' "$steps"); check "$said" "Could not check for a newer storytree (the release manifest could not be read); opening the installed 0.3.711.
| probe version release persist finish path" "a repeat that cannot read the release keeps the installed app"
release=0.3.711
st_op_install() { ST_ERROR="the app could not be moved into place"; return 1; }
present=no; steps=
refused "failed at install: the app could not be moved into place" "a failed install names its step" st_delivery "$app" arm64
case "$ST_ERROR" in *"run the same command again"*) ;; *) check "$ST_ERROR" "a retry action" "a failure says how to retry" ;; esac
check "$steps" " probe release download persist" "nothing after the failed step runs"

# Once installed it asks nothing (1.15, ADR-1162): its first words after the install say how to open the app.
ST_REPORT='{"command":{"status":"installed"},"tools":{"node":"/n","cli":"/c"}}'
said=$(st_opened "$root/Applications/it's storytree.app" < /dev/null)
check "$said" "storytree is installed, and its app is open. To open it again, use Applications, or run: open '$root/Applications/it'\\''s storytree.app'
In the app, connect your coding agents and, when you want one, add a project.
The storytree command is available in a new terminal window." "a Mac's last lines open the app first and ask nothing"
ST_SYSTEM=linux; ST_USERNS="$root/userns"; echo 1 > "$ST_USERNS"
check "$(st_opened "$root/share/storytree-0.3" | head -n 1)" "storytree is installed, and its app is open. To open it again, use your app menu, or run: '$root/share/storytree-0.3/storytree-0.3' --no-sandbox" "Linux opens the AppImage, without the sandbox where the kernel blocks it"
echo 0 > "$ST_USERNS"
check "$(st_opened "$root/share/storytree-0.3" | head -n 1)" "storytree is installed, and its app is open. To open it again, use your app menu, or run: '$root/share/storytree-0.3/storytree-0.3'" "and with it where the kernel allows it"
ST_SYSTEM=darwin; ST_USERNS=
ST_REPORT='{"command":{"status":"conflict","conflict":"/usr/local/bin/storytree"},"tools":{"node":"/n","cli":"/c"}}'
check "$(st_opened /a.app | tail -n 2)" "An existing storytree command was preserved: /usr/local/bin/storytree
Run this installation explicitly: '/n' '/c'" "a conflicting command is named after the app"

# The whole run, its install stubbed: what it says after installing is st_opened's, and nothing it reads.
st_delivery() { ST_REPORT='{"command":{"status":"installed"},"tools":{"node":"/n","cli":"/c"}}'; }
st_op_fuse() { :; }
said=$( (HOME="$root/user"; STORYTREE_HOME="$root/user/home"; st_main) < /dev/null 2>&1)
case "$said" in
  "storytree is installed, and its app is open. To open it again, use "*"
In the app, connect your coding agents and, when you want one, add a project.
The storytree command is available in a new terminal window.") ;;
  *) check "$said" "st_opened's three lines" "the run ends saying how to open the app, asking nothing" ;;
esac

if [ "$fails" -eq 0 ]; then echo "install.sh PASS"; else exit 1; fi
