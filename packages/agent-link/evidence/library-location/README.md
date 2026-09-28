# Library location · settings 10.5–10.6, routing 1.6, activity log 2.5, library 7.7

Increment `increment_5e6ac23db68f` (arc `arc_238ac88fdb14`; ADR-0734 decided, ADR-0735 how).

- **Setting** (capability 10): `storytree settings set library cloudsql <instance> <user>` or
  `… library local`; `settings show` lists it. Stored in `settings.json` as
  `{ "library": { "location": "cloudsql", "instance": …, "user": … } }`. Checked whole before
  anything is written.
- **One resolver** (capability 1): `locateLibrary()` reads the setting and hands back the library's
  own `connect()` options, `{ cloudSql }` or `{ url }` of the running app. `route()` carries it as
  `library`; the CLI door, `doctor`, the hooks, the status line, the tool server and the setup
  check all connect with it, and none builds an address of its own. In cloud mode no local owner
  record is read and nothing is opened.
- **Activity log** (capability 2): opened through a library connection, it keeps its lines in that
  connection's own database (`ownDatabase`, library contract 7.7), so it lives wherever the library
  does. [live-2.5.txt](live-2.5.txt): two connections as two machines write one project's lines on
  the real instance `storytree-498613:australia-southeast1:storytree-pg` and each reads both back.
- **Installed bundles**: the CLI and agent link now bundle the Cloud SQL connector (in a lazily
  loaded chunk). Checked by building the CLI to a temporary folder and running `arc list` from a
  temporary home set to the instance: it answered in ~4 s. The throwaway project database it made
  was dropped afterwards.

Not in this change: the desktop app (lifecycle 1.9, 1.10), which still starts its local Postgres.
