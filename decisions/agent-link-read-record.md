# Every knowledge read is recorded, and a new artifact has a default place

- **Front cover of:** stories/agent-link.md, capability 6
- **Full record:** ADR-0624 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0624`)

Every artifact an agent reads through storytree's tools is recorded, with the session, how it was found and how much.

Each entry says which session read which artifact, and when; how the agent found it (a search result, a
link from another artifact, a shelf, or its id); and whether it took a peek or the whole artifact. A later
decision the same day (ADR-0629) adds which agent made the read: the orchestrator, or a subagent by
its type and task, filled only when the harness reveals it, "unknown" otherwise, and never guessed.
The record is only ever added to, from the day it was built: nothing earlier is reconstructed. It
lives in the agent link's own activity log, beside the library.

It records what was reached, never what helped. No view may present a read as evidence that an artifact
was useful, and two reads close together are not evidence that a link was followed.

When an agent writes an artifact and names no place for it, the artifact goes onto the shelf of the
capability its session has claimed. A decision becomes a front cover there. A definition or other remaining artifact kind
links to the cover the session last opened on that shelf, or else to the shelf's first book. With an
empty shelf nothing is added and the agent is told so. With no claim there is no default, and a
place the agent names always wins. (The knowledge model redirected this default the same day it was
decided, since an artifact can no longer link to a capability.)

It was decided so that a later view of where agents go in the knowledge starts from real history,
with roots to hang it on, rather than starting blind.
