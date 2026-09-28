# winhooks — Claude Code's PowerShell tool (increment_0699737b141d)

On Windows without Git for Windows, Claude Code 2.1.283 has no Bash tool and runs commands with its
PowerShell tool (`tool_name: "PowerShell"`, `tool_input.command`), so storytree's hooks never heard a
command and the setup check never verified (acceptance: `packages/app-setup/evidence/acceptance/README.md`, row 2.6).

- `red.txt`: 3.6 (a PowerShell tool call makes no command lines), 8.1 (the registered matchers skip
  PowerShell), 8.2 (an older install's Bash-only matchers are not upgraded) failing.
- `green.txt`: the full run after the fix, every unit PASS.

The PowerShell hook input is the recorded Bash one with `tool_name` changed: the laptop's run showed the
tool's name and its `command` field; no raw PowerShell hook input was recorded. The retest on the reset
laptop (Git-less) must show all four hooks verified for Claude Code.
