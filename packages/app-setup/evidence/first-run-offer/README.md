# The installer asks nothing; the app's first run offers agents and a project (ADR-1162)

Increment increment_f8e05861e186, contracts 1.15, 2.13 and 3.13.

## The installer's final lines

Printed by `st_opened` (install.sh) with a stubbed report; install.ps1's `Get-StorytreeOpenedLines` says the same on Windows:

```
--- Linux
storytree is installed, and its app is open. To open it again, use your app menu, or run: '/home/mickh/.local/share/storytree-0.3/storytree-0.3'
In the app, connect your coding agents and, when you want one, add a project.
The storytree command is available in a new terminal window.
--- Mac
storytree is installed, and its app is open. To open it again, use Applications, or run: open '/Users/you/Applications/storytree-0.3.app'
In the app, connect your coding agents and, when you want one, add a project.
The storytree command is available in a new terminal window.
--- Windows
storytree is installed, and its app is open. To open it again, use the Start menu, or run: & 'C:\Users\you\AppData\Local\Programs\storytree-0.3\storytree-0.3.exe'
In the app, connect your coding agents and, when you want one, add a project.
The storytree command is available in a fresh Windows terminal.
```

The Windows lines are as `bootstrap.test.ps1` pins them; Windows CI runs that proof (no PowerShell on the Linux lane).

## The first-run guide

The built renderer in headless Chromium with a stand-in bridge: Claude Code found and not yet connected, Codex connected.

- `guide-offer.png`: the guide as it opens: one Connect for Claude Code, Codex said connected, and Add a project….
- `guide-connected.png`: after Connect Claude Code.

Not attested here: a live install on a real machine (the owner's check on an installed alpha).
