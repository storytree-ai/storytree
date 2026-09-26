# The agent link's revised tree: increment claims, the wait refusal, release on merge, and planning tools

- **Front cover of:** stories/agent-link.md
- **Full record:** ADR-0643 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0643`)

The agent link keeps its eight capabilities; claims, the agent tools, the habits card and the setup check grow.

An agent can claim an increment as well as a capability, and both read the same: the harness, when
the window opened, the reason, and whether the holder is live or idle. Claiming an increment that is
a proposal or ready starts it, through the library's own "start". One holder, no queue, and no
approval step anywhere: an agent readies and starts its own proposals.

Claiming or starting waiting work is refused, naming what it waits for (the owner's W2). That is an
increment whose own wait holds, every increment of an arc whose wait holds, and an increment held
on a question the owner has not answered. A capability claim is refused too when every open
increment naming that capability is waiting; a capability no increment names is never refused. The
agent link composes this from the library's own readings and keeps no copy of the wait rule.

A claim also ends when its pull request merges (the owner's M). For the MVP, storytree assumes the
user's project is on GitHub with CI, as storytree's own is. Each claim records its branch, and the
link asks GitHub, through `gh`, whether that branch's pull request has merged. That catches squash
merges too. Since 0.3's database is local, a merge is noticed at the next agent activity in that
project, not the moment it happens. The setup check requires `gh` signed in and says so plainly when
it is not. A git-only option for users off GitHub is after the MVP.

The agent tools grow by the planning tools: increments (park, ready, start, close with its outcome,
and record a landing that was never parked), arcs (park and unpark; an arc reopens when work is
parked on it, and reads closed when its last increment closes), waits (set and clear, with a
reason), questions (raise, settle with the owner's answer, retire one that was wrong), and friction
and re-steers with 0.2's evidence rules (the owner's n4). Every write goes through the library.

The habits card teaches three more habits: claim the increment you drive, close it with its outcome,
and raise a question on the arc instead of only asking in chat. The setup check also puts the
`storytree` command on the user's path.

The command line is not this story's. It is a story of its own, as in 0.2 (the owner's H): a front
door that sends each verb to the function its owning story already has.

Left out, because they did not last in 0.2 (measured under ADR-0639): increment plans, `increment
check` and the planner hand-off; a question's park lease; workspaces made by claiming; and
similarity search.
