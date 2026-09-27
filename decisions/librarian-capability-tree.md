# The librarian is a story of its own: six capabilities, on for 0.3's own library first

- **Front cover of:** stories/librarian.md
- **Full record:** ADR-0644 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0644`)

The librarian keeps a project's library honest as a library, and is a story of its own with six capabilities.

It is 0.2's librarian-curator, ported whole. Storytree 0.3 runs no agents of its own, so the
librarian is a hat the user's own agent puts on at a landing, using storytree's tools. It reaches
the library only through its API, holds no data of its own, and registers its tools on the agent
link's one tool server (the owner's H1).

The six capabilities, built in this order: Links (an artifact links only to what it rests on, starting
with the links ADR-0631 left for it), Decision log (every accepted decision stays true in full),
Catalogue (each artifact is new or an edit to the one that covers it), Graduation (durable lessons move
from the agent's memory into principles, processes and definitions), Queues (lapsed open questions
and friction are looked at and closed with a reason) and Rounds (when the pass runs, and how an agent is
told to run it).

It is built to work on any project and switched on for 0.3's own library first; users' projects get
it before first users (the owner's U1). The decision health check is a report in the librarian's
worklist, not a CI check, because each user's library is local (the owner's G1).

Left out, because it did not last in 0.2 (measured under ADR-0639): the separate
graduation-synthesist role, whose friction routing folds into Queues.

ADR-0654 restores ranked related-but-unlinked search after re-measurement showed the librarian
used it: Links uses it to find neighbours no edge reaches, alongside plain search.
The same decision restores the question review lease, seven days unless given another: Queues
uses the library's lapsed-question drain, longest lapsed first, leaving fresh and settled questions
out. A review may renew a still-valid open question; an answered one is settled with its answer,
and the library refuses to renew a settled question.
