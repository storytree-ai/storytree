# Where the starter pack's roles and notes came from (pack version 5)

Since pack version 8 (ADR-1094 D1) a new factory is seeded with none of these: the bare bones are the
record and the map. Each role, check and note below stays in the pack as a part the user takes in by
its title (`take_starter_pack` with `include`), with every note it links, once a build shows it is
needed (ADR-1094 D2).

Evidence for increment_d90f79ab4d9e, on the arc "A new project's library starts with the full system"
(ADR-0996). Read on 2026-10-11 from storytree's own library: its eight agent roles and the 65 notes (47 principles, 5 guardrails, 9 patterns, 4 processes)
they link as required reading (`context`), rules and anti-patterns. Every role section and note is
classified the way the 2026-09-27 fan-out classified 0.2's for 0.3 (ADR-0652):

- **BRING**: carried over in substance; wording changed only to drop storytree's own history
  ("in 0.2 …", decision numbers, friction ids), which ADR-0996 D2 leaves out.
- **ADAPT**: rewritten for a user's project (ADR-0996 D2). The project's own test command,
  `storytree check` and the pipeline `wire_pipeline` sets up stand in for storytree's `pnpm gate`,
  CI on three systems, merge queue, automerge, Mint box, pool and watcher; storytree's tools stand in
  for its `storytree …` commands and `pnpm build:guidance`; "the owner" becomes "the user".
- **FOLD**: the user pack already holds a note that says it (pack v1 and v2's principles); the
  role links that one instead of seeding a near-copy (the pack's own "Edit before adding").
- **DROP**: speaks only of storytree's own development, with the reason.
- **NEW**: written for a user's project, with no counterpart in storytree's own library.

The pack's text is in `starter-notes.ts` (notes) and `starter-roles.ts` (roles); `starter-pack.ts`
seeds them. Role titles stay as the pack named them since v1 (`orchestrator`, `librarian`), so the
setup check and projects set up earlier keep recognising them.

## Roles

| storytree's role | pack role | class | notes |
|---|---|---|---|
| session-orchestrator | orchestrator | ADAPT | Grown from the v1 slim role: claims and the capabilities list, decisions recorded (accepted when the user directed it, proposed while exploring), the review loop (kept from v2), the retro, the librarian pass, the Merge ceremony's closing leg and `close_out`, continue-or-stop with named reasons, escalation as a written question on the arc that is a landing, not a wait. Dropped: worktree provisioning, `pnpm gate`/`pnpm test` scope rules, ADR-0649's frame/front-door packages (storytree's own layout), the Mint watcher hand-over, the load-bearing ADR list, the health drain (`health_worklist` stays in the habits card), the one-parallel-lane rule (kept as the Parallel build-lane fan-out pattern). |
| librarian-curator | librarian | ADAPT | Grown from the v1 slim role to the six jobs: links, decision log, catalogue, graduation, queues, rounds, on the tools the server already serves (`worklist`, `link`, `correct`, `supersede`, `annotate`, `retire`, `park`, `graduate`, `route`, `settle_question`). Dropped: the question review lease and `renew` (no tool serves it), `storytree adr …` and `build:guidance` (storytree's own generated files), the 60-day memory lease detail, partition-by-target-decision (a storytree multi-lane hazard). |
| change-reviewer | change-reviewer | BRING | Already adapted in pack v2 (increment_fc1e5be1f918); unchanged text, and it now also carries its rule (A compliance gate …). |
| explorer | explorer | BRING | Tools named as the user's server serves them (`search_notes`, `open`, `show_plan`, `focus`); "a stale generated copy of a library note" dropped from step 3 (a user's project has no generated guidance). Dropped: `model: sonnet`, `effort` (they configure storytree's own generated agent files; role files in a user's agent folders are arc_4e3323a6b963's open point, ADR-0996 D3). |
| story-author | story-author | ADAPT | ADR-0649's three rules become one: one package per story (`packages/<story>/src`, where storytree draws it), and a delivery mechanism (a driving adapter such as a command line, or the composition root) holds no story's logic. storytree's own `packages/app`, `apps/desktop`, `packages/cli` dropped. `storytree tree` / `library new` replaced by the plan tools. model/effort dropped (as explorer). Step 1 states ADR-1078's baseline story rules in established terms, with no worked example (pack v7; ADR-1071's in v6). |
| frontend-builder | frontend-builder | ADAPT | Its description named storytree's own surfaces (forest planet, arc surface, desktop app): now "the project's visual surfaces". Seeded Chromium/Electron capture kit becomes the project's committed capture harness. "One drawn element per signal" dropped with its note (below). model/effort dropped. |
| blind-reviewer | blind-reviewer | ADAPT | Kept: verdict recorded first with everything read, never reading another reviewer's evidence, HELD on exposure. Dropped: the Mint dispatcher, `arc show | sed` filter and `adr list --load-bearing` (storytree commands), `bwrap` by name (now "a disposable network-isolated sandbox"), SHA-256 of the evidence, clearing a parent's wait (storytree's review fan-out). model/effort dropped. |
| corpus-investigator | corpus-investigator | ADAPT | `storytree library …` / `question list` / `adr list` replaced by the server's read tools; "the local Postgres is not running" becomes "storytree unreachable". model/effort dropped. |

## Notes

Uses: SO session-orchestrator, LC librarian-curator, CR change-reviewer, EX explorer, SA story-author,
FB frontend-builder, BR blind-reviewer, CI corpus-investigator; c = required reading, r = rule, a = anti-pattern (refuse).

| storytree's note (kind) | used by | class | pack note / reason |
|---|---|---|---|
| Test creation principles (principle) | CR c | FOLD | Already in pack v2, adapted there (own-health skip kinds dropped). |
| Slow growth: the minimum to green (principle) | SO r, FB r | FOLD | Pack's "Minimum to green"; its smells added to how to apply. |
| Minimum test to red: pin the missing behaviour, nothing else (principle) | SO r | FOLD | Pack's "Minimum test to red". |
| Red-green (principle) | FB r | FOLD | Pack's "Minimum test to red" (write it, see it fail, then pass). |
| Edit-first curation (pattern) | SO r, LC r | FOLD | Pack's "Edit before adding"; its search across every guidance kind, and naming the search, added. |
| A compliance gate turns a judgment ceremony into theatre (principle) | SO r, LC r, CR r | BRING | 0.2 anecdote dropped. |
| A contract that says "observable" must name its observer (principle) | FB r, SA r | BRING | Example made generic. |
| Cross-story dependency direction and the no-cycle rule (principle) | SA r | ADAPT | 0.2's ci-cd/studio trap dropped; "a package.json dependency draws the road" (the habits card's map rule) added. |
| Two-consumer extraction (principle) | LC r | BRING | |
| Signal and noise (principle) | LC c | BRING | |
| Deep modules (principle) | SA c | BRING | Source named in full. |
| Legible at the resting view (principle) | FB r | ADAPT | storytree's forest-map incident dropped; "primacy is the owner's" becomes the user's. |
| The resting view is designed, not fitted (principle) | FB r | ADAPT | As above. |
| Exploration principles (principle) | CI r | BRING | |
| Claim by write-ownership — the capability you will write (principle) | SO r | ADAPT | "through the MCP server" and 0.3's package rule restated for one package per story; refusal is never a user question. |
| Defects amend the owning capability (principle) | SA r | BRING | |
| One way to do things (principle) | SA r | BRING | Owner quote and 0.2 studio dropped. |
| An observable is evidence only for what it observes (principle) | CI r | BRING | 0.2's reaper/install incidents generalised. |
| Implementation outranks the doc (principle) | CI c, LC r | BRING | |
| A spec body describes only what it contracts (principle) | SA r | BRING | |
| Reference, don't restate (principle) | SO r, EX c+r, LC r | ADAPT | "generated guidance" and `storytree library search` replaced by search_notes. |
| The owner-fork bar: escalate ownership, not uncertainty (principle) | SO r | ADAPT | Retitled "The user-fork bar …"; the "Standing delegation" definition and ADR-0794 dropped (storytree's own). |
| Register follows audience (principle) | SO r | ADAPT | The owner becomes the user; 0.2 anecdote dropped. |
| The splitting rule (principle) | SA r | BRING | ADR-1071 wording (pack v6): capabilities and contracts only; stories follow the journey principle. ADR-1078's terms (pack v7). |
| Route structural forks to story-author, not the owner (principle) | FB r | ADAPT | Retitled "… not the user". |
| An awaited notification is never a turn-ending state (principle) | LC r | BRING | |
| The author of the work is not its only witness (principle) | BR r | ADAPT | "CI verifying the merge with main" becomes the project's pipeline and the fresh-context review. |
| Machine in the loop is the default; a human is the exception (principle) | FB r, SO r, SA r | ADAPT | Owner quote, ADR-0826 and "Standing delegation" dropped. |
| Decide against a standard, not a budget (principle) | FB r, SO r, SA r | ADAPT | "82 of the owner's sessions" dropped. |
| Escalate inline, or on a named signal (principle) | SO r, SA r | ADAPT | raise_question named as the instrument. |
| A decision that blinds an instrument escalates inline (principle) | LC r | ADAPT | storytree's "sixteen gate checks" dropped; examples are the user's pipeline and review. |
| No claim without evidence (principle) | FB r, EX r, CI r | ADAPT | `pnpm test`/`pnpm typecheck` become the project's test command. |
| Read the force a decision answered, not the clause it left behind (principle) | SO r | BRING | |
| A deferral recorded without a status reads as pending work (principle) | SA r | BRING | |
| Prose names a set it never checked (principle) | CI r | BRING | |
| Delegate exploration to digest-returning subagents (principle) | SO r, EX c+r | ADAPT | 0.2's token figures dropped; `model: sonnet` becomes "a cheaper model if your harness lets you choose"; a harness without subagents uses a separate session. |
| Guidance quality: structure over emphasis (principle) | LC r | BRING | |
| Plain language first (principle) | SO r, EX c+r | ADAPT | Owner becomes user. |
| A check that could not run is unverified, not refuted (principle) | BR c, CI r | BRING | 0.2 incidents generalised. |
| The journey principle (principle) | SA r | ADAPT | ADR-1078's baseline story rules in established terms (pack v7; ADR-1071's in v6); the shop and map examples dropped; storytree's delivery mechanisms (its command line, MCP server, desktop shell) generalised. |
| Mechanical waiting never pays context rent (principle) | SO r | BRING | |
| Verify an edit persisted, or escalate (principle) | FB r, SO r, SA r | BRING | |
| Citing a document is not reading it (principle) | CI r, LC r | BRING | |
| Accepted decisions carry no stale prose (principle) | SO r, LC r | ADAPT | Operations named as the user's tools (correct, supersede, annotate). |
| Friction earns durable guidance by supporting evidence, not by being reported (principle) | SO c, LC r | BRING | Mem0 audit figure dropped. |
| The authoritative source beats the derived one (principle) | CI r, LC r | ADAPT | "generated guidance" examples dropped. |
| Observability-first (principle) | FB c, SO r | DROP | storytree's own product principle ("could the desktop app show it?"): a user's project designs its own state. |
| One element per signal (principle) | FB r | DROP | storytree's forest-planet visual vocabulary, by its own statement. |
| Verification is never bypassed (guardrail) | SO a, BR a | ADAPT | Three-system CI, automerge and `gh pr merge` become the project's test command, `storytree check`, the pipeline and the review. |
| The owner owns the outer loop (guardrail) | FB a, SO a | ADAPT | Retitled "The user owns the outer loop"; `storytree question …` becomes raise_question / settle_question. |
| Escalate up when blocked or out of scope (guardrail) | FB, EX, SA, CI, LC a | BRING | |
| The library is the edit surface (guardrail) | SO a, LC a | ADAPT | `pnpm build:guidance`, `check:guidance` and generated files dropped (a user's project has none). |
| Ask the user before changing the imported code (guardrail) | SO a | NEW | Pack v4, from ADR-1015 (increment_8c73fecde8f8): storytree's own project imports nothing, so it has no such note. The habits card says the same; this note is what a search of the user's library for "changing the imported code" finds. |
| An agent never self-attests (guardrail) | FB, SO, SA, BR a | ADAPT | "0.3 has no signed-verdict spine" and ADR-0794 dropped. |
| Parallel build-lane fan-out (pattern) | SO c | ADAPT | 0.2's measurements, the EnterWorktree harness trap and the Mint box dropped; make_workspace names the claimed workspace. |
| Proof-walkthrough first (pattern) | SA r | BRING | |
| Decompose by testability; delegate the glue (pattern) | SO c | ADAPT | "through its own subagents" becomes "a subagent where your harness has one"; storytree's decision numbers, its main-process crash and the Slow growth link are left out, and "numbered test" is said as a test whose title carries the contract number. |
| Pull-based context architecture (pattern) | SO, EX, CI, LC c | ADAPT | Bootstrap named as check_setup, the roles and show_plan rather than CLAUDE.md. |
| An example carries its discriminator (pattern) | SA r, LC r | BRING | |
| When a term is in question, the definition note wins (pattern) | LC r | ADAPT | storytree's layers and 0.2's glossary dropped. |
| Pair the fence with the affordance (pattern) | SA r, LC r | BRING | |
| Render and witness a flag-guarded surface (pattern) | FB c | ADAPT | storytree's desktop capture kit (`apps/desktop/src/capture`) becomes the project's committed capture harness. |
| Merge ceremony (process) | SO c | ADAPT | `pnpm gate`, three-system CI, automerge, the merge queue, the Mint watcher hand-over and the context-mark figures dropped; the project's pipeline and its own merge practice (asked once and recorded) stand in. |
| Pre-merge librarian pass (process) | SO c, LC c | ADAPT | Guidance regeneration dropped; the friction drain step made explicit. |
| Library edit ceremony (process) | SO c | ADAPT | `build:guidance`, the command line's `@file` and shell-quoting rules (the habits card names only the tools a user's agent has) and friction ids dropped. |
| Friction adjudication (process) | LC c | ADAPT | `storytree arc increment new --remedies` becomes park_increment and add_remedies. |

Pack version 5 (increment_e3895e1ac1bf) adds the notes no role of storytree's links, which `factory-contents.md` marks IN (BRING here) or ADAPT, and links each from the role it serves:

| storytree's note (kind) | used by | class | pack note / reason |
|---|---|---|---|
| Price the deferral (principle) | SO r | BRING | 0.2's measured examples kept without their history; "doc-vs-implementation-precedence" named as the pack's Implementation outranks the doc. |
| Durable notes carry intent, not implementation surface (principle) | LC r, SA r | BRING | 0.2's eviction history dropped. |
| Tightening a shared contract needs a full sweep (principle) | SO r | ADAPT | `pnpm test` and 0.3's scoped runs become the project's tests and a scoped run in general. |
| A story's proof proves the goal, not the surface (principle) | SA r | BRING | 0.2's UAT practice named as Minimum test to red's story-level form. |
| Cold rebuild (principle) | SA r | BRING | 0.3-as-a-port-of-0.2 dropped. |
| Stateless graduates, stateful stays (principle) | LC r | BRING | Names the graduate tool. |
| An escape sequence in a tool argument becomes a real byte (principle) | SO r | BRING | 0.2's incidents kept as general examples; "pass prose to storytree" becomes any command line. |
| The same file in another tree is a different file (principle) | SO r, CI r | BRING | 0.3's training-wheels second repository dropped; worktrees named as make_workspace's. |
| A human's words are stored verbatim, or not at all (principle) | LC r | ADAPT | "His" becomes the user's; the schema-refusal wording advice (storytree's own schema) dropped. |
| An owner-approved reference is repo-resident (principle) | FB r | ADAPT | Retitled "A user-approved reference is repo-resident"; `docs/design/<topic>/` becomes a design folder. |
| De-noising promotes a signal, never drops it (principle) | FB r | ADAPT | "Observability surface" becomes any dense view; its links to Show what matters now and Nothing is out of reach (OUT) become the declared, recoverable hide they describe. |
| Types stay honest (guardrail) | SO a, FB a | ADAPT | For a TypeScript project; 0.2's oxlint rungs and `pnpm typecheck` become the project's type check and any linter. |
| A measured claim carries the method that produced it (pattern) | LC r, CI r | BRING | 0.2's audit kept as an example; `storytree library list question` becomes the query that counted. |
| Grill me: walk the owner through his open questions (process) | none | ADAPT | Retitled "Grill me: walk the user through their open questions"; the Mint box dispatch, Windows PowerShell rules, ADR numbers, friction ids and the 22-round evidence counts dropped; storytree's commands become the user's tools. No role links it: the user's words trigger it. |
| Stage the owner's look (process) | SO r, FB r | ADAPT | Retitled "Stage the user's look"; ADR-0794 dropped. |
| Attempt privileged actions, approve inline (process) | SO r | ADAPT | A `gh` mutation becomes a change on the project's host. |
| Justify a new check (process) | SO r | ADAPT | CI and `pnpm test-ratio` become the project's pipeline and a command the user runs; 0.2's sixteen retired rungs kept without their numbers. |
| Migrate a library schema: expand, migrate, contract (process) | SO r | ADAPT | Retitled "Migrate a schema: expand, migrate, contract" and generalised to any schema the project owns; storytree's library schema dropped. |

The pack seeds 56 principles, 8 guardrails, 9 patterns and 9 processes: the pack's own four
principles and its module-mock guardrail (v1 and v2), and every note above that is not folded or
dropped. Not here: projects already set up (increment_aa6273267336), role files in a user's agent
folders (arc_4e3323a6b963).
