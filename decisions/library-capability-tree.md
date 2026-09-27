# The library's capability tree

- **Front cover of:** stories/library.md
- **Full record:** ADR-0621 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0621`)

The library is built as eight capabilities, with one database per project on a local Postgres.

In build order they are project libraries, library transactions and the data schema; then the work
model and knowledge artifacts, side by side; then the health record and the library API; and last
a cloud connection. Anything outside the library reads and writes it only through the library API.

Each project is its own database, so nothing written in one project can show up in another, and
deleting a project is dropping its database. Stories belong to the project. An arc may list the
stories it grows, but it need not: a research arc may touch no story at all.

Storytree ships a local Postgres. A user may connect to a Google Cloud SQL database instead, signed
in with their own Google account. Other clouds wait until someone asks for them.

The library stores health and answers questions about it. Claims and the agent's tools belong to
the agent link, and starting Postgres belongs to the desktop app. Nothing in the MVP runs a story's
tests when a part lands: the owner dropped verified health on 2026-09-26 (ADR-0630), so users'
projects get only what the agent reports, and the verified column is written only by the seed, for
storytree's own stories.

Left out compared with 0.2: its single cloud instance and credential handling, the web door to the
store, the library's command line and browse screens, 0.2's corpus (0.3 starts nearly empty), story
files kept in a repo and copied into the store (in 0.3 the library is the only copy), most of 0.2's
knowledge kinds, its proof machinery, arc increments, decision numbers and decision status tags.

Two later decisions made the same day add to it. The agent link's tree gives the library API three
edits: edit a story, a contract and an arc. The knowledge model adds a ninth capability, knowledge
entrances, and its decision is that capability's front cover.

ADR-0650 narrows capability 6: there is no library memory type; knowledge records are artifacts.
