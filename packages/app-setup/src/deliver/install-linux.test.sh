# Get storytree 1.13: the same one-liner's Linux branch, run under sh, bash and zsh by install-sh.test.ts.
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

# System and chip: x64 Linux goes on; an Arm one is told why.
refused "x64" "an Arm Linux is refused" st_platform Linux aarch64
st_platform Linux x86_64; check "$ST_SYSTEM $ST_ARCH" "linux x64" "x64 Linux is accepted"

# FUSE: the AppImage runs through libfuse2; its absence names the one apt command, which storytree never runs itself.
st_fuse "	libfuse.so.2 (libc6,x86-64) => /lib/x86_64-linux-gnu/libfuse.so.2" || check refused accepted "libfuse2 present"
refused "sudo apt install libfuse2t64" "libfuse2 missing, with only libfuse3" st_fuse "	libfuse3.so.3 (libc6,x86-64) => /lib/x86_64-linux-gnu/libfuse3.so.3"

# Installation folder: ~/.local/share, unless this installation's own record names another.
st_install_dir "$root/none" "$root"; check "$ST_DIR" "$root/.local/share/storytree-0.3" "the default Linux folder"

# The release: the manifest's Linux entry names the AppImage and its checksum.
st_fetch() { printf '%s' "$manifest" > "$2"; }
sum=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
manifest='{"schema":1,"channelSchema":1,"version":"0.3.123","macos":{"arm64":{"name":"storytree-0.3-0.3.123-mac-arm64.zip","sha256":"'$sum'"}},"linux":{"x64":{"name":"storytree-0.3-0.3.123-linux-x86_64.AppImage","sha256":"'$sum'"}}}'
st_release development x64 "$root/manifest.json"
check "$ST_PAYLOAD_URL" "https://github.com/storytree-ai/storytree/releases/download/v0.3.123/storytree-0.3-0.3.123-linux-x86_64.AppImage" "Linux takes the release's AppImage"
check "$ST_PAYLOAD_SHA" "$sum" "and its checksum"
manifest='{"schema":1,"channelSchema":1,"version":"0.3.123","macos":{"arm64":{"name":"storytree-0.3-0.3.123-mac-arm64.zip","sha256":"'$sum'"}}}'
refused "no Linux app" "a release without the Linux app" st_release development x64 "$root/manifest.json"

# Installing: a stand-in AppImage that extracts as the real one does, from a folder laid out like the release's.
image="$root/image"
mkdir -p "$image/resources/agent-tools" "$image/usr/share/icons/hicolor/512x512/apps"
printf '{"schema":1}' > "$image/resources/agent-tools/payload.json"; printf node > "$image/resources/agent-tools/node"
printf png > "$image/usr/share/icons/hicolor/512x512/apps/storytree-0.3.png"
ln -s usr/share/icons/hicolor/512x512/apps/storytree-0.3.png "$image/storytree-0.3.png"
printf '[Desktop Entry]\nName=storytree-0.3\nExec=AppRun --no-sandbox %%U\nIcon=storytree-0.3\nX-AppImage-Version=0.3.123\nMimeType=x-scheme-handler/storytree-auth;\n' > "$image/storytree-0.3.desktop"
appimage="$root/download/storytree-0.3-0.3.123-linux-x86_64.AppImage"
mkdir -p "$root/download"
printf '#!/bin/sh\n[ "$1" = --appimage-extract ] || exit 9\nmkdir -p squashfs-root\ncase "$2" in\n  "resources/agent-tools/*") mkdir -p squashfs-root/resources && cp -R "%s/resources/agent-tools" squashfs-root/resources/ ;;\n  *) mkdir -p "squashfs-root/$(dirname "$2")" && cp -P "%s/$2" "squashfs-root/$2" ;;\nesac\n' "$image" "$image" > "$appimage"
HOME="$root/a home"; ST_TMP="$root/tmp"; mkdir -p "$ST_TMP"
dir="$HOME/.local/share/storytree-0.3"
st_install_appimage "$appimage" "$dir" || check "$ST_ERROR" installed "the AppImage installs"
check "$(ls -A "$dir" | sort | tr '\n' ' ')" "resources storytree-0.3 storytree-0.3.png " "the folder holds the AppImage, its tools and its icon"
[ -x "$dir/storytree-0.3" ] || check "not runnable" runnable "the installed AppImage is runnable"
check "$(cat "$dir/resources/agent-tools/payload.json")" '{"schema":1}' "the agent tools sit beside it, where toolPaths reads them"
check "$(cat "$dir/storytree-0.3.png")" png "the icon is the file, not a dangling link"
entry="$HOME/.local/share/applications/storytree-0.3.desktop"
check "$(grep '^Exec=' "$entry")" "Exec=\"$dir/storytree-0.3\" --no-sandbox %U" "the menu entry starts the installed AppImage with the release's arguments"
check "$(grep '^Icon=' "$entry")" "Icon=$dir/storytree-0.3.png" "and shows the installed icon"
check "$(grep -c 'storytree-auth' "$entry")" 1 "and keeps the sign-in scheme"
check "$(st_appimage_version "$dir/storytree-0.3")" 0.3.123 "the installed version is read from the AppImage itself"
check "$(printf 'Exec=AppRun\n' > "$root/plain.desktop"; st_desktop_entry "$root/plain.desktop" '/o$d "q"/storytree-0.3' /i.png)" 'Exec="/o\\$d \\"q\\"/storytree-0.3"' "a path with shell characters stays one quoted argument"

# PATH: the marked line goes in ~/.profile, which a Linux login shell reads.
check "$(st_profile_file)" "$HOME/.profile" "Linux's login profile"

if [ "$fails" -eq 0 ]; then echo "install.sh PASS"; else exit 1; fi
