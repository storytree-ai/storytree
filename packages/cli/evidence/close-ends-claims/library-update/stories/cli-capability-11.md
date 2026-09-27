## 11 · Workspace

**As built — release from a terminal.** `storytree workspace release
<increment|capability>` calls the agent link's existing public `release` function.
It releases only a claim held by the calling agent session, identified from
`CLAUDE_CODE_SESSION_ID` or `CODEX_THREAD_ID`. It leaves the increment open and
does not report a capability landed, delete a workspace or change a library
record. The agent link owns the check and the `released` line under its project
lock.

If another session holds the work, the refusal names its holder and reason. If
nobody holds it, the refusal says so. A shell without an agent session is refused
with instructions to run from the agent's shell. Refusals leave claims unchanged.

**Contract 11.5.** `workspace release` ends the calling session's increment or
capability claim without closing or landing the work. Proven by
`packages/cli/src/workspace.test.ts`, test 11.5, through both harness identities.

**Contract 11.6.** `workspace release` refuses another session's claim, an unheld
target, and a shell without an agent session, without writing claim events.
Proven by `packages/cli/src/workspace.test.ts`, test 11.6.

Workspace creation and attachment retain their existing contracts 11.1–11.4.
Release shares their dependency on the agent link's claims (capability 5).
