# Chaos drills for 0.3 — DRAFT for the owner

**Non-binding recommendation: adopt two small regression drills: “Stalled database contact returns control” and “A cancelled queued edit stays cancelled.”** Both exposed present behaviour worth fixing. Keep the other trials below as one-off evidence unless you choose to retain them. This is a proposal, not an adoption, a new release gate, or permission to build a chaos framework.

Think of an office: temporarily lock the filing room, then cancel a clerk's waiting amendment. When the door opens again, the cancelled amendment should not quietly enter the file. The analogy breaks at the commit boundary: a database write already committed cannot be undone merely by cancelling its caller. The cancellation trial deliberately stopped the write **before** it could change the record.

The original “storytree hangs while running a user's tests” candidate is dropped under your existing decision, **ADR-0630**: 0.3's MVP does not run users' tests. Its development app still checks **its own** health; that does not restore the removed user-test runner. The nearest real blocking seam is a library call waiting on a database connection or writer lock, tried here.

## The shortlist and every candidate's disposition

Times are one Linux run, excluding installation, snapshot restore and time waiting for the shared machine lock. These are measurements, not performance guarantees. All faults used a throwaway local Postgres, real product APIs/executables, and ordinary signals or SQL locks. No Electron window or real agent harness was needed.

| Drill / seam | What actually happened | Measured run cost; infrastructure | Incident class; proposed disposition |
| --- | --- | --- | --- |
| **Stalled database contact returns control** — freeze Postgres before new CLI/MCP connections | CLI still waiting at 6.5s; MCP still unanswered at 6.5s despite its advertised 3s connection bound. Resume: CLI succeeded at 6.534s; MCP returned “isn't running” at 6.516s. Hook gave up cleanly at 2.192s. **B1.** | Database script 7.329s including stop/restart below; MCP script 7.916s including session restart below. Linux `SIGSTOP`/`SIGCONT`, one server. | Slow/wedged contact and misleading DB status: H3, H5. **Adopt** a bounded-contact regression beside the existing connection tests; exact deadline is an owner/product choice. |
| **A cancelled queued edit stays cancelled** — cancel an MCP edit while a writer lock prevents it writing | Cancellation sent while old title was intact. After unlocking, the cancelled title committed with the caller in history. No tool response before the probe's 10s deadline. **B2.** | 10.400s, mostly waiting to establish the missing response; one MCP child, one SQL lock. | Ambiguous late writer: H5. **Adopt**, subject to your choice of cancellation semantics; add a named contract before implementation. |
| Stop Postgres during an in-flight read, then restart | Read failed explicitly. CLI while down exited 1 in 365ms. The **same** library handle then read 8 stories and all 7,149 history entries. | Included in 7.329s above; `pg_ctl -m immediate stop`, table lock to hold a real read. | DB interruption, H3/H5 analogues. **One-off by recommendation**; retaining a subprocess recovery test is your named alternative. |
| Kill the hook during an append | Observed the real `INSERT` waiting inside its transaction; killed hook at 166ms. No line from it committed; next hook exited 0 in 158ms and wrote one complete line. | 452ms; one hook child and a temporary SQL trigger/lock, removed afterward. | Interrupted process, H2 analogue; no exact 0.2 hook incident established. **One-off by recommendation**; keep if this process boundary warrants an extra atomicity regression. Missing the killed event is expected best-effort capture, not durable-delivery proof. |
| Restart MCP while a session holds work | Held claim survived `SIGKILL`; rival was refused; restarted server with the same session reclaimed and released it. Claim list then empty. | Included in 7.916s above; three short-lived MCP processes over real stdio. | Orphaned ownership, H2 analogue. **One-off by recommendation**; retaining a restart regression buys process coverage at the cost of protocol/process setup. No real harness restart was tested. |
| Two projects open/write together; block one project's writer | Both CLI creates succeeded, and hooks stayed in their own logs. While A was blocked, B edited successfully in 372ms. A's app-API description and CLI title both survived, with ordered history. CLI waited silently until unlock, finishing at 7.268s. | Combined script 7.920s, including deliberate 6.5s pause; two project databases, CLI children, one SQL lock. | Shared-resource contention H1/H7; cross-field loss H6. **One-off by recommendation**; retain existing project-isolation and field-merge tests. A stalled lock is an availability concern; this run showed no clobber. |
| **Added:** two first opens of the same new project | Both independent CLI callers succeeded (444/434ms); both stories present. Later read succeeded. | 815ms; two CLI children. | Concurrent startup, H7's July antecedent. **One-off by recommendation.** One successful race does not prove every interleaving. |
| **Added:** kill the database's owning app process | A second live owner was refused. After killing the owner, CLI said “isn't running” in 373ms while orphan Postgres still existed. Next owner stopped/replaced it; 8 stories/7,149 entries remained; clean shutdown followed. | 1.221s; small headless host using the app's real local-Postgres owner API. | Orphaned child H2. **One-off by recommendation**: the local-Postgres suite already kills an owner and checks recovery. |
| User-test runner / recursive junction cleanup | User-test runner is absent by ADR-0630; junction recursion is a separate Windows harness/workspace seam, not any of the Linux database trials. | No runtime trial; no compatible Windows junction environment here. | H1/H2/H4 remain real history. Removed runner needs no new cut. **Your named choice:** commission a separate Windows workspace-cleanup drill, or leave it outside this set. A disposable Windows/harness rig here would outgrow the seam under study. |

**Your alternatives:** adopt the two named regressions (small recurring cost, covers two demonstrated gaps); keep all results as one-off exploration (no new test maintenance, leaves these gaps dependent on later fixes); or retain specified additional rows (more process coverage, more setup/flakiness). None is silently enacted. Whether either bug should hold first users is also your choice; this arc currently says the scoping does not itself block first users.

Do not promote this folder into a runner. Its **397 lines** are disposable reproduction notes, including guards, process plumbing and protocol setup. Existing tests already cover real Postgres transactions, field merges, project isolation and dead-owner recovery. A cancellation test can use that existing database/tool setup. The connection suite already has a tiny silent TCP server for Cloud SQL; the equivalent local-connection behaviour can be pinned there without a fault-injection service. A permanent scheduler, random fault matrix, Windows process-control abstraction or shared fixture framework would exceed this proposal.

## Bugs found — reproduction and impact, no fixes in this lane

### B1. The tool's connection deadline does not bound library startup

Run `database.mjs` and `mcp.mjs` as below. With the owner alive, suspend only the throwaway Postgres postmaster before a fresh connection. At 6.5s the CLI has not exited and `show_plan` has not answered. Resume Postgres: CLI answers successfully; MCP returns its not-running answer only after the stall ends.

`packages/agent-link/src/tools/connections.ts:11` declares a 3,000ms reachability bound, but applies it only to `openActivityLog` at line 38. `reach` awaits the library first at line 45. `packages/library/src/project/server.ts:36` creates local pools without a connection timeout. Thus the activity timeout does not free the caller from the stalled library open. These source facts support an unbounded-wait risk; **the experiment observed 6.5 seconds, not an infinite wait**. The CLI's silent wait on a writer lock was also observed, but no lock-wait deadline is currently promised, so that duration alone is not a second proven defect.

Impact: an agent call can keep waiting past the intended connection bound when an address exists but its database cannot finish a handshake. The hook's independent bound worked. Fix and regression belong in the library/agent-link owning work, outside this draft. Proposed expectation: bounded, actionable failure, with a subsequent call able to recover. This trial did not check a second call on the stalled MCP instance after its delayed refusal.

### B2. A cancelled, still-queued MCP edit commits without an answer

Run `cancel-write.mjs`. It warms the MCP connection, creates one synthetic story, holds `storytree.record-writes`, calls `edit_plan`, observes that call blocked on the lock, and sends `notifications/cancelled` for that request. The record still says `Before cancellation`. After 250ms for delivery, release the lock. Within the following 250ms its title is `CANCELLED EDIT STILL WRITTEN`, with a second history entry attributed to `session:chaos-cancelled-session`. No result arrives before the **probe's** 10s deadline.

Impact: abandoning a waiting tool call does not retract its mutation, so the caller can believe work stopped while the file changes later. This is the present analogue of the old ambiguous live writer. **No newer edit was overwritten in this trial**, and cancellation cannot undo an already committed write. `packages/agent-link/src/tools/server.ts:143` passes no cancellation signal into the action/library; the database write waits for its advisory lock and proceeds. This finding needs an explicit contract choice: honour cancellation before commit where possible, or clearly define writes as continuing and provide a way to determine their outcome. The recommendation favours the former for a write demonstrably still queued; protocol cancellation is not being claimed as a guaranteed rollback contract already in the library.

No product files were changed. No unexpected loss of previously committed records was observed. Both reports need supervisor-owned build increments if selected.

## What 0.2 actually establishes

Read-only sweep: approximately **2026-08-15 through 2026-09-26**. Counts below are documented episode lower bounds, never keyword hits or process counts. Costs are recorded costs, not extrapolated totals. `M` below is `/home/mickh/.claude/projects/-home-mickh-code-Storytree/memory/`. Friction IDs can be read in full using the command after the table.

| Ref | Measured class, frequency and cost | Evidence |
| --- | --- | --- |
| H1 | **At least 3** shared-machine saturation episodes: Aug 15, 21, 23. Aug 15: 8 gates, 108 Node processes, 1.4GB available; 36/44/57-minute runs versus about 13 minutes quiet. Aug 21 identical tree passed after load cleared. Aug 23 took 3 gate cycles before a 12-minute clean run. | `M/concurrent-gates-wedge-on-the-shared-dev-box.md:15`, `:176`, `:205`. |
| H2 | **2** orphan-child episodes: Aug 16 dead subagent left an 11-process gate for **8h14m** (42.6 CPU-seconds, not eight CPU-hours); five sibling lanes died, some leaving 62 uncommitted files. Aug 21 a timed-out wrapper's child invalidated **~25 minutes** of measurement; 349.8/280.1s loaded versus 64.5s clear. | `M/orphaned-gate-blocks-for-hours.md:11`, `:39`; friction `a-timed-out-background-run-keeps-running-and-is-invisible-to-storytree-own`, Evidence/Impact. |
| H3 | **2** false DB-down diagnoses, not two proven DB outages. Aug 20: probe failed after **45.015s** under 8 gate roots/89 Node processes, next command connected. Sep 8: missing TypeScript loader said unreachable despite an **8.971s SELECT 1**; **~12 minutes** wasted. | Frictions `db-probe-reports-unreachable-when-the-local-box-is-saturated`, `studio-health-reports-db-unreachable-when-the-loader-is-missing`, Evidence/Impact. |
| H4 | **1 underlying Aug 13–19 outage**, overlapping the window: recursive Windows junction cleanup blocked session starts. Aug 16 three cleaners held **11,161MB**; Aug 19 clearing four changed available memory **0.53→13.30GB**. Repro: **154,373 warnings**, 29.5 minutes at ~85% of one core; remove back-edge and identical clean finishes in **58s**, exit 0, zero warnings. No deletion established. | `M/claude-harness-git-clean-wedges-on-worktrees.md:12`, `:148`, `:185`; 0.2 commits `2ed924af`, `af21e52f` and their bodies. |
| H5 | **Outside-window antecedents:** Aug 12/13 **1** edit remained live **~50 minutes without committing** at the fresh-read checks; replacement finished in ~40s. Record establishes risk, not an eventual commit or a later overwrite. Undated memory separately reports **3** killed “hung” writes had already committed. June 27 cold start **~21 minutes**; July 5 real handshake wedge **~28 minutes**, restart ~2 minutes. Full-window recurrence unmeasurable here. | Friction `hung-background-task-never-notifies-no-inventory`; `M/pg-write-commits-before-poolclose-hang.md:10`; `M/db-slow-cold-start-not-wedge.md:24`, `:47`. |
| H6 | **Outside-window antecedent, Aug 12:** 3 interleaved edits replaced 2 of 4 intended fields, **~10 turns** to reconcile. Its adjudication measured **5 cross-actor clobbers across 5 artifacts over 21 days**, all cross-field; **0 observed same-field collisions**. Field-scoped edits under row lock subsequently fixed that measured class. | Friction `concurrent-library-artifact-edits-clobber-with-no-detection`, Evidence/Route reason. Do not count those five as five new in-window incidents. |
| H7 | **Outside-window analogues:** July 13 **1** machine-global configuration race, two failed walks plus a scratch-profile crash, **~25 minutes**. July 31 **1** concurrent database-start collision, **~10 minutes**. Neither establishes contamination between two project stores. | Frictions `friction-machine-global-config-cross-session-race`, `concurrent-db-up-collides-on-cloud-sql-409`. |

```sh
pnpm -C /home/mickh/code/Storytree/.claude/worktrees/planet-books \
  storytree library search 'hung'
pnpm -C /home/mickh/code/Storytree/.claude/worktrees/planet-books \
  storytree library artifact hung-background-task-never-notifies-no-inventory --full
git -C /home/mickh/code/Storytree show -s --format='%h %cs %s%n%b' af21e52f 2ed924af
```

There was **no established exact historical match** for a killed hook append, MCP restart losing a session, or two project stores mixing. Those rows test analogous operational boundaries. “Every expensive incident was operational and no unit test could catch it” would be too broad: process integration tests and the right timeout/transaction tests can catch these failures. Chaos is the deliberate runtime fault, distinct from mutation testing's changes to code.

**Measure-first result (ADR-0639):** searched all **885 friction records**, 0.2 git history and tracked filenames, and all **15 JSONL transcripts, including 5 under `subagents/`**, available in the named project directory. Those transcripts actually cover only **September 4–8**, with five tiny startup files; they cannot prove regular use throughout August–September. The Sep 8 false-diagnosis episode has a contemporaneous transcript at `7e3be20e-efc2-4956-adf7-dd47e4b89dfb.jsonl:689` under that directory. Repeated copied guidance was not counted as another incident.

Searches found **0/885 friction records mentioning chaos**, **0 chaos-named tracked files**, and **0 commits matching `git log --all --since=2026-08-15 --until=2026-09-27 --grep=chaos -i`**. A source hit in `packages/agent/src/codex-author.ts:839` is promotion fault injection with an injected runner, not a running-system chaos framework. **No former chaos machinery identified; longevity unmeasurable.** There is therefore no evidence-backed “not brought: did not last” claim to make, and no 0.2 machinery is proposed for porting. Under ADR-0633/0639, every optional exclusion above remains your named choice; zero search hits are not permission to cut something that worked.

## Reproduction and observed output

Observed on base commit `a756a059bfa0b10da2ecede24c47c3d27e63d35b`, branch `spike/chaos-scope`, 2026-09-27 UTC / September 28 Sydney. Linux `6.14.0-37-generic`, Node `v24.19.0`, embedded Postgres 17.10 package. Snapshot: `2026-09-27T14-03-38-576Z.json`, SHA-256 `68680e42e0e15c43c7210f653297093cf8d0820273664e21334ced4a145835af`. Restore reported **1,400 records, 7,149 history entries**; first cluster creation 0.5s, start 0.1s. Full restore duration was not separately timed. The isolated home occupied 95MiB after all probes.

Restore into a new marked home; never substitute a real app home. From this worktree:

```sh
export STORYTREE_HOME=$(mktemp -d /tmp/storytree-chaos.XXXXXX)
touch "$STORYTREE_HOME/.chaos-throwaway"
flock /tmp/storytree-heavy.lock node --import tsx scripts/restore-library.mjs \
  /home/mickh/storytree-lanes/snapshots/2026-09-27T14-03-38-576Z.json --project storytree
node --import tsx docs/chaos-repros/host.mjs
```

Keep that host in one terminal. In another, set `STORYTREE_HOME` to the **same newly created path** and run these sequentially from this worktree (each command takes the shared lock):

```sh
flock /tmp/storytree-heavy.lock node --import tsx docs/chaos-repros/database.mjs
flock /tmp/storytree-heavy.lock node --import tsx docs/chaos-repros/hook.mjs
flock /tmp/storytree-heavy.lock node --import tsx docs/chaos-repros/mcp.mjs
flock /tmp/storytree-heavy.lock node --import tsx docs/chaos-repros/projects-writers.mjs
flock /tmp/storytree-heavy.lock node --import tsx docs/chaos-repros/cold-open.mjs
flock /tmp/storytree-heavy.lock node --import tsx docs/chaos-repros/cancel-write.mjs
flock /tmp/storytree-heavy.lock node --import tsx docs/chaos-repros/owner-death.mjs
```

The final drill kills the original host, recovers through a replacement, and shuts that replacement down. Other scripts leave the host running. These notes use Linux signals and `/proc`; they are not Windows/macOS verification. The host is the real database-owning API without Electron, not a claim to have exercised desktop startup, rendering, project switching or a harness's automatic reconnect. The writer race used the app's public library API, not clicks in a window. SQL locks/triggers are fault injection only in synthetic project/activity databases. The restored `storytree` project was only read; no owning arc, increment, question or decision was edited, claimed or closed. No 0.2 write or live 0.3 access occurred.

The app's **process ownership** lock stops two server owners; it does not exclude CLI writers. Each project's **transaction write** lock serializes app/CLI edits. These two mechanisms were tried separately. The seed/update lock and a restart during a seed were not exercised; retaining that additional updater seam is another possible owner choice, not evidence claimed here.

Each final fault placement ran once. The hook probe needed one setup correction: its first table lock blocked the hook's schema check, so it never reached an INSERT and timed out in the probe. That was not counted as an interrupted-append result. The final temporary trigger held the actual INSERT. No statistical confidence or platform-wide proof is implied.

Representative stdout, verbatim except selected events and shortened successful listings:

```text
database.mjs:
{"event":"baseline","stories":8,"history":7149}
{"event":"in-flight-read","error":"Connection terminated unexpectedly"}
{"event":"cli-while-down","code":1,"signal":null,"ms":365,"stdout":"","stderr":"connect ECONNREFUSED 127.0.0.1:36395"}
{"event":"same-handle-after-restart","stories":8,"history":7149}
{"event":"startup-still-stalled-at-6500ms","cliExited":null,"hookExited":0}
{"event":"hook-after-stall","code":0,"signal":null,"ms":2192,"stdout":"","stderr":""}

hook.mjs:
{"event":"killed-hook","code":null,"signal":"SIGKILL","ms":166,"stdout":"","stderr":""}
{"event":"next-hook","code":0,"signal":null,"ms":158,"stdout":"","stderr":""}
{"event":"committed-lines","lines":[{"session":"chaos-surviving-hook","kind":"file-edited","seq":8}]}

mcp.mjs:
{"event":"claims-after-release","claims":[]}
{"event":"mcp-first-contact-at-6500ms","answered":false}
{"event":"mcp-after-resume","ms":6516,"isError":false,"text":"storytree isn't running, carry on without it"}

projects-writers.mjs:
{"event":"project-isolation","a":["Only A"],"b":["Only B"],"aSessions":["chaos-session-a"],"bSessions":["chaos-session-b"]}
{"event":"cli-write-still-blocked","exited":null}
{"event":"both-fields-survive","fields":{"title":"CLI title","description":"App description"},"history":[{"seq":1,"actor":"session:01a0e334-c72e-7dd1-ac0c-bb0fa69a9ce2","fields":{"title":"Only A"}},{"seq":2,"actor":"chaos:app","fields":{"title":"Only A","description":"App description"}},{"seq":3,"actor":"session:01a0e334-c72e-7dd1-ac0c-bb0fa69a9ce2","fields":{"title":"CLI title","description":"App description"}}]}

cold-open.mjs:
{"event":"stored-after-race","stories":["First caller","Second caller"]}
{"event":"drill-finished","ms":815}

cancel-write.mjs:
{"event":"cancel-sent-before-unlock","requestId":3,"fields":{"title":"Before cancellation"}}
{"event":"record-after-cancel-and-unlock","fields":{"title":"CANCELLED EDIT STILL WRITTEN"},"history":[{"seq":1,"fields":{"title":"Before cancellation"}},{"seq":2,"actor":"session:chaos-cancelled-session","fields":{"title":"CANCELLED EDIT STILL WRITTEN"}}]}
{"event":"cancelled-call-response","error":"Probe deadline (10s), not product deadline: tools/call"}

owner-death.mjs:
{"event":"cli-after-owner-death","code":1,"signal":null,"ms":373,"stdout":"","stderr":"storytree isn't running: open the storytree app, then run this again"}
{"event":"orphan-postgres-still-alive","pid":1018948}
{"event":"after-owner-recovery","stories":8,"history":7149}
```

The owner-recovery host also printed `stopping a server left running by a process that has since stopped`, stopped it in 0.3s, started on a new port in 0.1s, then exited 0 after a 0.1s clean stop. Full temporary command output was retained on this machine at `/tmp/chaos-{database,hook,mcp,projects-writers,cold-open,cancel-write,owner-death}.log`, with the unsuccessful initial hook placement at `/tmp/chaos-hook-setup-attempt.log`. The commands above reproduce the evidence without those temporary files.
