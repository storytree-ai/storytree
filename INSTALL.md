# Installing storytree

This page is written for the agent a user asked to install storytree, and for anyone installing it by hand.
Follow it from the top: check what the computer needs, run the one command for its platform, and if a
check stops the install, tell the user what the step below says. What the commands do and check, in more
detail: [apps/desktop/README.md](apps/desktop/README.md).

Install only from this repository, [github.com/storytree-ai/storytree](https://github.com/storytree-ai/storytree).
Storytree is not published on npm, PyPI, Homebrew, winget, Docker Hub or any MCP registry: a package there
under its name is not storytree's, so never install one (see [Official sources](README.md#official-sources)).

## Before you run anything

- **An agent.** The user needs Claude Code or Codex, installed and signed in. Storytree runs on their own
  subscription and includes none.
- **A supported computer.** Windows x64 (an arm64 build is included but not yet tested); a Mac with Apple
  Silicon (M1 or later; Intel Macs are not supported); or Linux x64 (x86_64). On anything else, stop and
  tell the user storytree does not install there yet.
- **No clone.** The install needs no checkout of this repository, no npm and no global Node. Do not clone it
  to install: an agent opened in a clone takes on storytree's own development guidance (its CLAUDE.md and
  AGENTS.md, a session-start hook and a tool server). Cloning is for working on storytree itself; see
  [How changes land](README.md#how-changes-land).

## Windows

In Windows PowerShell (5.1+) or PowerShell 7, run:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.ps1')))
```

It picks the computer's architecture, downloads that installer from this repository's
[Releases](https://github.com/storytree-ai/storytree/releases), checks its checksum, installs the app and
opens it.

- **SmartScreen.** This release is unsigned. If Windows shows a SmartScreen warning, tell the user it is
  Windows' warning about unsigned downloads, and that if they trust the download they can choose
  **More info → Run anyway**.
- **Smart App Control.** If Windows says **Smart App Control** blocked it and offers no Run anyway, that is
  Windows 11's reputation check on unsigned apps. Tell the user they can see whether it is on in Windows
  Security → App & browser control → Smart App Control settings. Turning it off there lets storytree
  install, but Smart App Control then stops checking every app on the computer (Defender antivirus keeps
  running). On Windows 11 with the April 2026 update or later it can be turned back on from the same page;
  before that update, turning it back on needs a reset or reinstall of Windows. It is their choice: do not
  change the setting for them. If they would rather keep it on, they wait for a signed release.

## Mac

On a Mac with Apple Silicon, in a terminal, run:

```sh
curl -fsSL https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.sh | sh
```

- **Apple Silicon only.** On an Intel Mac the command stops and says storytree needs Apple Silicon. Tell the
  user an Intel Mac is not supported.
- **Signed by storytree.** The command installs only an app signed by storytree's Apple team. If it says
  macOS does not yet accept the downloaded app, Apple may still be checking a new release: nothing was
  installed, so run the same command again in an hour.

## Linux

On an x64 computer, in a terminal, run the same command:

```sh
curl -fsSL https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.sh | sh
```

- **An ordinary user.** Run it as the user, not as root or with sudo: the app and its database both refuse
  to run as root. If the session is root, tell the user to run it from their own account.
- **A desktop session.** The installer opens the app's window to start its database, so it needs a display
  (`DISPLAY` or `WAYLAND_DISPLAY` set). On a machine with no desktop (a server, a container, WSL without
  its graphics layer, a box reached over ssh) the install cannot finish: tell the user to run it in a
  terminal on their desktop.
- **libfuse2.** The app is an AppImage, which mounts itself through FUSE. Where libfuse2 is missing, or FUSE
  is present but cannot be used (as in many containers), the installer says so and sets the app to run
  unpacked each time it starts (`APPIMAGE_EXTRACT_AND_RUN=1`, in its menu entry too), which needs no FUSE.
  To let it mount normally, the user adds libfuse2 with `sudo apt install libfuse2t64` (on Ubuntu before
  24.04, `sudo apt install libfuse2`). Storytree never runs sudo itself: offer the command, and let the
  user run it.

## Stable or alpha

The commands above install the stable channel: a build that was tried before it was offered, which can be
weeks and hundreds of releases behind the newest. Install the alpha channel only when the user asks to follow
every release as soon as it is published. On Windows:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.ps1'))) -Channel alpha
```

On a Mac or Linux:

```sh
curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.sh | sh -s -- --channel alpha
```

An installation keeps its channel, so neither command switches one already installed: it stops and says the
installation already uses the other channel. To switch, the user chooses **Updates → Update channel** in the
app where their build has it; otherwise they run `storytree setup uninstall` first, then the other channel's
command.

## When a step fails

Every command names the step it stopped at and why, then says to run the same command again; a failed run
never replaces the user's projects or agent settings. Tell the user that message in plain words, fix what it
names if the user agrees (or say what they must do), and run the command again.

## Once it is installed

The command opens the app. **Help → First-run guide** in the app covers setup, connection checks, the
offline license and feedback, and is there before the user has a project. To check a download by hand,
compare its SHA-256 with the digest beside it on the
[release page](https://github.com/storytree-ai/storytree/releases); the commands make this check
themselves.
