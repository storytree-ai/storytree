# Get storytree: the installed command on Windows is a program of its own

Capability `capability_790ee7f22546` (1 · Get storytree), with `capability_199d7af33d32`
(8 · Setup check, the agent link), increment `increment_fb9373a85ee5`, decision ADR-0854,
contract 1.9 (`contract_de2fbc790c73`). Measured on the owner's laptop, Windows 11 arm64,
2026-10-02.

## Why no batch file can do it

A launcher of the installed command's exact shape (`@echo off` / `rem …` /
`goto #_storytree_handoff_# 2>nul || "<node>" "<cli>" %*`) around a script that prints its words:

- From Git Bash, `./storytree.cmd 'he said "website -> forest -> the rest" ok'` printed nothing
  and wrote a file `the` holding `["he said \"website - - rest\" ok"]`.
- From Windows PowerShell 5.1, the same word arrived as `["he said website","-","-","rest ok"]`
  in a stray file `the`; `'say "a & echo INJECTED" ok'` ran `echo INJECTED`; `100%PATH%` expanded.
- From Git Bash, words with no space did it too: `a&echo INJECTED` ran `echo INJECTED`, `x|y` ran `y`.
- A batch file that never expands its arguments (`echo !CMDCMDLINE!` only) still had its output
  written to `the`: cmd.exe applies `>` when it parses the caller's `/c` line, before the batch's
  first line runs. So reading `%CMDCMDLINE%` inside the batch comes too late.
- PowerShell prefers a `.ps1` beside a `.cmd`; under `-ExecutionPolicy Restricted` (Windows'
  default on a home or work PC) it refused the `.ps1` ("running scripts is disabled on this
  system") and did not fall back to the `.cmd`. Git Bash found neither a `.cmd` nor a `.ps1` by
  its bare name.

## The program

`packages/agent-link/src/setup/launcher.c`, built by `packages/agent-link/src/bins/launcher.ts`
with clang, lld-link and llvm-dlltool (LLVM 22.1.6 here; CI's Windows image has LLVM 20.1.8):
4,608 bytes for each of x64 and arm64, about 150 ms to build each. With the marker, Node and the
script appended, from Git Bash, PowerShell 5.1 and cmd.exe:

- Git Bash: inner double quotes, `>`, `&`, `|`, `%PATH%`, `^`, a trailing backslash, an empty
  word, a tab, an apostrophe and a quoted word all arrived as the caller's line spelled them; an
  exit code of 7 and piped input passed through; `storytree` was found by its bare name.
- PowerShell 5.1 by bare name, a `.cmd` beside it in the same folder: the program ran, and
  `a&echo`, `x>y`, `100%PATH%`, `x|y` and `^c` arrived unchanged. A word holding a space and an
  inner quote arrived split (PowerShell 5.1's own quoting, as for any program); written with `\"`
  it arrived as written. That split is `increment_e95ceec15288`.
- cmd.exe: `storytree "a > b" x^&y` arrived as `a > b` and `x&y`, cmd's own syntax read once.
- While it ran, deleting the program was refused (`EPERM`) and renaming it worked: hence D3's
  rename and deferred delete.
- The x64 build runs on this arm64 laptop under emulation, with the same results.

## Files

- `routes.ts`: installs the command into a temporary home and starts it from each caller, printing
  what the script heard and any file written. `STUB=<a built storytree-launcher.exe>` makes the
  program's version; without it the installed command was the batch file.
- `red-routes.txt`: the batch launcher. Git Bash: `storytree: command not found`; as
  `storytree.cmd` from a folder whose path holds a space, cmd.exe could not even start it; a
  program: `ENOENT`; PowerShell 5.1: heard `["a"]`, wrote a file `y` and ran `y`.
- `green-routes.txt`: the program. Every caller heard every word; no file was written.
- `red.txt` and `green.txt`: contract 1.9's test before and after.
