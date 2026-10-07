# Windows agent-tools database profile

Measurement for increment_d1f0dc3011fa, following PR #811. This is evidence, not a benchmark gate or a new product promise.

## Method

- CI run: https://github.com/storytree-ai/storytree/actions/runs/37639053003
- Instrumented head: ac387581e85d187cc12135d7f575cd10620a0a69 (temporary instrumentation is in this PR's first two commits and removed from its final tree).
- Same full test command on Linux, macOS and Windows: `pnpm test`. Tests used the runner's throwaway Postgres on loopback TCP, with the existing durability-off settings. The shared library was not involved.
- Selected only `agent-tools.test.ts`, `agent-tools-reads.test.ts` and `agent-tools-writes.test.ts`: 61 fixture lifetimes and 349 calls through the existing test Agent helper on each system. Direct SDK calls used by some tests remain in the fixture/body totals but are not in the helper-call total.
- Timed the existing fixture phases and helper calls with `performance.now()`. `AsyncLocalStorage` associated each `pg.Client.query` and `pg.Client.connect` with the active phases. Counting at Client avoids counting a Pool query twice. Callback and promise forms were preserved.
- On each test file's first fixture, opened one additional connection, warmed it with `SELECT 1`, then measured 50 sequential `SELECT 1` calls (150 per OS). This baseline uses the same test server under the suite's concurrent load.
- `summary.json` groups the emitted `DBPROFILE` records by phase, file and whether a helper call opened any connection, and aggregates query count and duration by normalized SQL. Literal test database tokens were normalized; query parameters were not logged. The CI job logs retain the source records.

Times are one run per OS, under concurrent suite load. Query timings include execution, locks, transport and client scheduling; connection timings include connection establishment and PostgreSQL startup/authentication. This profile does not separate those components. Sums can overlap where connections or queries run concurrently and nested phase totals must not be added together. The suite intentionally tests stalled handshakes; their deadlines remain in the all-call totals. Medians and the trivial-query baseline help distinguish those from ordinary calls.

## Outcome

The query-count hypothesis is refuted in this run: Windows and Linux each made **6,387 queries in 349 helper calls**. Their 150 warmed `SELECT 1` queries averaged **0.445 ms on Windows and 0.468 ms on Linux**. There is no general threefold loopback-query penalty in this sample.

| Measured value | Linux | macOS | Windows |
| --- | ---: | ---: | ---: |
| Mean helper call, ms | 22.13 | 19.37 | 76.65 |
| Median helper call, ms | 5.34 | 3.37 | 8.04 |
| Queries in helper calls | 6,387 | 6,372 | 6,387 |
| Mean helper-call query, ms | 0.521 | 0.332 | 0.709 |
| Warmed `SELECT 1`, mean ms/query | 0.468 | 0.251 | 0.445 |
| Baseline fresh connection, mean ms (3 samples) | 14.97 | 9.18 | 51.95 |
| Calls opening connections: median ms (84 calls) | 28.36 | 15.90 | 180.81 |
| Calls reusing connections: median ms (265 calls) | 4.27 | 2.63 | 6.41 |
| Fresh project open, mean ms (61 samples) | 39.38 | 53.44 | 241.96 |
| Fresh project connection, mean ms (122 connections) | 3.32 | 2.73 | 45.63 |
| Project drop, mean ms (61 samples) | 21.21 | 58.07 | 119.37 |

The 84 calls that opened connections account for **16.08 s of the 19.03 s Windows–Linux difference in summed helper-call time (84.5%)**. They issue exactly the same 3,119 SQL queries on those two systems; those queries differ by only 0.25 s in summed duration. This localizes the large gap to calls with first-use connection work, rather than an extra-query path or uniformly slow SQL. It is a grouping of the observed cost, not a claim that connection time alone causally explains 84.5%.

Fresh project creation also does the same 18 queries on each OS (1,098 total), but opening its two connections and creating its new database is much slower on Windows. The database lifecycle costs are distinct from the warmed query baseline. macOS also has a slower database drop without the Windows connection cost.

All three platform jobs passed. The complete agent-link unit took 62.3 s on Linux, 51.0 s on macOS and 144.9 s on Windows; these are unit elapsed times, unlike summed fixture/call durations.


The agent tool server already keeps its connections and opened libraries (`src/tools/connections.ts`). Fresh test fixtures and fresh MCP servers intentionally exercise their first-use paths. This sample does not justify changing query behavior, connection reuse semantics, database isolation, timeouts or test coverage. The cause inside Windows connection establishment and database creation is not resolved by these client-side timings.

No optimization is claimed, so there is no before/after speedup. No additional product test was added: this increment measures existing behavior. All temporary instrumentation is removed before this evidence lands.
