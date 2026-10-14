# What a user's factory holds (ADR-1040)

Evidence for increment_f98714a7c1a2, on the arc "A user's factory: their own version of storytree,
everything but our memory" (arc_fe6e7f164a52). Read on 2026-10-15 from storytree's own library and
this repository. Every part of storytree's system is marked by ADR-1040 D2's test, the user's
success:

- **IN**: goes into the factory as it is (wording may drop storytree's own history, as the starter
  pack already does).
- **ADAPT**: goes in rewritten for a user's machine and project ("the owner" becomes "the user";
  storytree's own gate, CI, merge queue, Mint box, pool and watcher give way to the project's test
  command, `storytree check` and the pipeline `wire_pipeline` sets up).
- **OUT**: stays out, with the reason. Storytree's memory is always out (D3).

It is a session's reading, recorded rather than asked; the owner corrects it by editing this file.
The starter pack (`starter-pack.ts`, pack version 4) is the factory's seed: everything it already
seeds is IN or ADAPT, and `starter-pack-classification.md` holds those calls, so they are not
repeated here.

## Roles

All eight of storytree's agent roles are already in the pack, classified in
`starter-pack-classification.md`: change-reviewer and explorer IN, the other six ADAPT. Storytree's
library holds no other role.

## Notes

The 65 notes the roles link are classified in `starter-pack-classification.md` (two DROP:
Observability-first, One element per signal). These are the notes no role links, which the pack
does not seed yet:

| storytree's note (kind) | class | reason |
|---|---|---|
| Price the deferral (principle) | IN | Holds for any project's deferred work. |
| Durable notes carry intent, not implementation surface (principle) | IN | The user's library rots the same way. |
| Tightening a shared contract needs a full sweep (principle) | IN | General to any shared validator. |
| A story's proof proves the goal, not the surface (principle) | IN | The story-author's method, for any story. |
| Cold rebuild (principle) | IN | As above. |
| Stateless graduates, stateful stays (principle) | IN | The user's agents graduate memory with `graduate` too. |
| An escape sequence in a tool argument becomes a real byte (principle) | IN | Every agent that calls tools meets it. |
| The same file in another tree is a different file (principle) | IN | `make_workspace` gives the user's sessions worktrees too. |
| A human's words are stored verbatim, or not at all (principle) | ADAPT | His words become the user's: re-steers and settled questions hold them. |
| An owner-approved reference is repo-resident (principle) | ADAPT | The owner becomes the user. |
| De-noising promotes a signal, never drops it (principle) | ADAPT | Storytree's own views become any dense view the frontend-builder makes. |
| Types stay honest (guardrail) | ADAPT | For a TypeScript project, which is what `import_project` reads; storytree's own examples dropped. |
| A measured claim carries the method that produced it (pattern) | IN | General. |
| Grill me: walk the owner through his open questions (process) | ADAPT | The user's own open questions, arc by arc; sending the work to the Mint box dropped. |
| Stage the owner's look (process) | ADAPT | The user's look. |
| Attempt privileged actions, approve inline (process) | ADAPT | The user's go-ahead. |
| Justify a new check (process) | ADAPT | For a check the user adds to their own pack; storytree's recorded history becomes the project's. |
| Migrate a library schema: expand, migrate, contract (process) | ADAPT | Generalised to any schema the user's project owns; storytree's library schema dropped. |
| 0.3's curated load-bearing decision set (principle) | OUT | Memory: it is a view of storytree's decision log. |
| Your attention goes where you send it (principle) | OUT | Storytree's own product principle for its surfaces, as Observability-first. |
| Nothing is out of reach (principle) | OUT | As above. |
| Show what matters now; hide the rest (principle) | OUT | As above. |
| Signals must be real (principle) | OUT | As above. |
| A container image storytree builds is born with a cleanup policy and layer reuse (principle) | OUT | Storytree's own hosting bill. |
| Let a Node process end on its own after a fetch; never process.exit() then (principle) | OUT | One runtime incident of storytree's own platform. |
| Run the app's globe surfaces in a static page from a saved reading (pattern) | OUT | Storytree's own app. |
| Measure a reader's egress from the shared library (process) | OUT | Storytree's hosted library. |
| Drive a Windows test machine from a session (process) | OUT | Storytree's own test box. |
| Changing a release secret (process) | OUT | Storytree's own releases. |
| Affected-only test scope (process) | OUT | Storytree's `pnpm test`; the project's own test command stands in. |
| Standing delegation (definition) | OUT | The pack already dropped every use of it. |
| Story text: … (about 460 definitions) | OUT | Storytree's own stories' text: its plan, not a method. |
| Dated research (7 definitions) | OUT | Memory: research done for building storytree. |

## Checks

| part | class | reason |
|---|---|---|
| The six quality control checks | ADAPT | Already in the pack (pack v2, with Module mock). |
| `storytree check`: the package rule and the allocation rule | IN | Already run by the pipeline `wire_pipeline` sets up. |
| Graduated guardrail: self-equal assertion | ADAPT | Today only storytree's gate runs it; it belongs in `storytree check`, so the user's pipeline enforces what Tautological expected value graduated to. |
| Storytree's gate and its dev-loop checks (guidance, plan edges, package boundaries, type imports, own health, test ratio, coverage map) | OUT | They check storytree's own repository; the project's test command, `storytree check` and the review stand in (ADR-0996 D2). |

## The habits card

IN, whole. `packages/mcp-server/src/instructions/habits.ts` composes it from the sections of the
packages the server mounts, and every user already gets it. Only what it says about roles changes
once a project reads them from its factory.

## The plan's structure

| part | class | reason |
|---|---|---|
| Stories, capabilities and contracts | IN | The plan tools already serve them. |
| Arcs and increments, as a method | IN | `park_arc`, `park_increment`, `make_workspace`, `close_increment`. Storytree's own arcs and increments are memory, OUT. |
| Questions, friction, re-steers, health, the QA ledger, claims and sessions, as mechanisms | IN | The user's own records of them. Storytree's records of them are memory, OUT. |
| Decisions, as a mechanism | IN | The user's own decision log. Storytree's is memory, OUT. |

## Guardrails and processes of building storytree

| part | class | reason |
|---|---|---|
| Hooks: the context bar, recording reads, the claim before an edit | IN | Connecting a harness installs them. |
| Worktree per claimed increment | IN | `make_workspace`. Storytree's worktree provisioning script is OUT. |
| Review, then gate, then land | ADAPT | Already in the orchestrator role and the Merge ceremony note (pack v4). |
| `pnpm gate`, three-system CI, merge queue, automerge | OUT | The project's pipeline and its own merge practice stand in. |
| Mint box, pool, dispatcher, lanes, watcher, the heavy-run lock | OUT | Storytree's own build farm. |
| Generated guidance (`build:guidance`, CLAUDE.md and AGENTS.md from roles) | OUT for now | Role files in the user's agent folders stay ADR-0996 D3's open point (arc_4e3323a6b963). |

## Memory, always OUT (ADR-1040 D3)

Storytree's decision log, its arcs and increments, owner questions, friction, re-steers and session
history, with the research and story text above.

## Where the rest is built

Making the factory is onboarding, so it stays in the app setup story (ADR-0978). Inheritance, a
project reading its roles, notes and checks from its factory with its own edits winning, is how a
project library is read, so it belongs to the library story, beneath every reader (`search_notes`,
`open`, the review's brief, `check_setup`), rather than a new story every reader would have to route
through. Each step is an increment on the arc.
