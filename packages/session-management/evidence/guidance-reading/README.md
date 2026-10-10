# Context guidance readings

Contract 9.7 adds guidance to the existing reading. All existing fields remain; `guidance`
holds `value` (tokens), `source` (`default` or `set`) and `position` (`under`, `at` or `past`),
or `absent` with the settings reader's explanation. Each reading calls capability 10's
`readSettings`; there is no second settings-file parser. No count is enforced as a limit.
Both CLI text/JSON and the MCP tool carry the guidance. No reading still has no token count.

- [red.txt](red.txt): after pushed red commit `9122d47`, the focused context and MCP run
  failed five assertions about the absent guidance fields/text (35 passed, 5 failed).
- [green.txt](green.txt): typecheck and full test results, run under the shared heavy-work lock.
- [captures.txt](captures.txt): real command-function output against a throwaway Postgres,
  including default, set/under, set/past, equality, JSON, a changed setting, malformed settings
  with an already available activity log, the routing refusal below, and no transcript.
- [library-update](library-update/README.md): snapshot-based patch and supervisor checklist.

The focused green run passed all 40 tests. `pnpm gate` also passed typecheck and all 14 units;
its guidance check was NOT RUN because no generated roles or their library notes changed.
The full scope is required because the test harness itself depends on agent-link.

## Remaining routing dependency

The reader meets the unusable-settings case when its activity log is available: it retains
450,000 tokens and reports the settings reader's precise error. A fresh `storytree context`
or `read_context` call first routes its library through the same settings file. If the file
is already unusable, routing refuses before the reader gets the transcript path. The captures
reproduce the CLI route refusal; MCP shares that routing entry point in `tools/server.ts`.

The current routing rule explicitly forbids treating an unusable settings file as local;
choosing a fallback or changing the settings reader is outside this lane's fence. This PR
lands the completed reader and output increment, but **does not claim the whole of 9.7 is
proved end to end**. The supervisor must retain this case as residue on `arc_748792ea3487`
when recording the landing of `increment_79be6b5a62b6`.

No decision/question records or live-store claims/closures were written. There are no visual
changes needing screenshots or owner acceptance. Library curation adds the as-built and
remaining-integration paragraphs to the existing capability description; no decision-log or
agent-role curation was needed.
