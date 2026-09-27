# The app's capability tree

- **Front cover of:** stories/app.md
- **Full record:** ADR-0634 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0634`)

The app has three capabilities, Lifecycle, Storytree projects and Surfaces, and it carries the live reading's reads without owning the reading.

In build order: Lifecycle starts and stops the database that holds every project's library, one
owner at a time. Storytree projects lists the projects and shows one at a time, and decides which is
on show when the app opens. Surfaces hosts the surfaces for the project on show, and carries
everything they read, since the page cannot reach the database. They are named for what the app
durably does, and every decision that shapes one is a book on its shelf.

The forest is the surface the app opens on, and the forest hosts the arc surface as an overlay, so
there is no Forest | Arcs toggle (ADR-0633). The live reading that keeps the surfaces current stays
the arc surface's. The app only carries the two reads it asks for, the library's changes and the
agent log's new lines since a point, for the project on show, and owns no timing.

Growing storytree 0.3 comes first. So the project switcher stays as built, and the app keeps opening
on 0.3's own project, until 0.3 is in a good place. The work that serves users' own projects waits,
due before first users: the project list keeping itself current, which project a user's app shows,
the first-run fix, the empty app telling a user how to add a project, and the `storytree` default
giving way to the project just set up or the one last opened. Nothing of it is cut; only the order
moved.

Lifecycle and Storytree projects were built before the story existed, so they rest on existing
tests. Surfaces' new parts are built red→green.

There is no "left out" list. The app's agent-written cuts went to the owner by name and are decided
(ADR-0636 D3, ADR-0637): the app keeps recording with its window closed (Lifecycle, contract 7),
the app updates itself (a fourth capability, Updates), and noticing a stopped database and starting
it again in place waits. The cuts he made himself stand: 0.2's one shared cloud database,
a Claude login in the keychain with a backend beside the hosted studio, and the terminal, an artifact
browser and 0.2's forest.
