# The agent link's capability tree

- **Front cover of:** stories/agent-link.md
- **Full record:** ADR-0626 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0626`)

The agent link has eight capabilities, its own log beside the library, and a setup check at every session start.

In build order they are project routing, the agent activity log, hooks, sessions, claims, the agent
tools (an MCP server), the instructions (a habits card) and the setup check.

The link keeps its own agent activity log beside the library rather than inside it. Sessions,
activity, claims and artifact reads live there. So the arc surface and the forest read from two places:
the library for the plan, health and knowledge, and the log for who is on what and what happened.

A capability has one holder at a time, and there is no queue. A second agent is refused with the
holder's name and picks other work. A claim ends when its holder lands or releases it, when its
session ends, or when another agent takes it over after the holder has gone idle.

Codex gets the same two layers as Claude Code, through user-level hooks and Codex's one-time
approval. Until a session's first hook line arrives it is flagged "hooks not running", so a missing
hook never looks like an agent doing nothing.

The user installs only the tool server. Every session start then checks the setup and fixes it on
the spot: it opens storytree if it is closed, registers the hooks if they are missing, and asks the
user before setting a folder up as a project. Every hook is proven to fire before real work starts,
and the connection shows as verified only then.

The active layer is an MCP server rather than a command line. It hands the agent its menu of tools
and the habits card at every session start, and checks each call's inputs with no shell quoting.

Knowledge entrances belong to the library, and the agent link only uses them through its tools. The
library API gains three edits for this story: edit a story, a contract and an arc.

Left out compared with 0.2: the claim board's grades, queue and roles, self-declared presence,
identity by worktree folder, 0.2's session-start hooks and generated instructions, its command line,
and its build workers, prove-it spine and paid builds.
