# Lag allocation execution evidence

The read instrument's existing proof (`read-latency.test.mjs`, contract 8.1) runs the instrument
against the test Postgres. On 2026-10-02 it passed; `pnpm lag:reads --delay 5 --rounds 1 --reads
arcViews` then measured three queries and 7 ms on the standard seed (25 arcs with eight increments
and one question each, five stories with three capabilities and two contracts each, 40 log lines).
This single timing is execution evidence, not a performance threshold.

`runtime.cpuprofile` is an unedited V8 Inspector capture from Node v24.19.0 on Mint, recorded on
2026-10-02 with a 10,000 us sampling interval. SHA-256:
`60593cde11cec6108dd85cd86dd311d14aff5688735382ebea75010241747e51`.
The capture ran this work between `Profiler.start` and `Profiler.stop`:

```js
function measuredWork() {
  const end = performance.now() + 120;
  let n = 0;
  while (performance.now() < end) n += Math.sqrt(++n);
  return n;
}
measuredWork();
```

The 13 samples have 13 matching intervals totalling 122,322 us. `measuredWork` has 13,916 us self
time and 100,798 us inclusive time. The first interval is 11,429 us. Before the fix, analysis dropped
that interval and shifted the others to the preceding sample: 111 ms total, 16 ms self and 107 ms
inclusive for `measuredWork`. Correct analysis prints 122 ms, 14 ms and 101 ms respectively.

`desktop-lag.test.mjs` (contract 8.2) feeds this recorded execution to both `summary` and the actual
`desktop-lag.mjs --analyze` entry. Its temporary `result.json` is an explicitly unmeasured envelope
with empty desktop metrics. This proof covers the kept instrument's CPU analysis; no Electron
interaction, native capture or desktop performance measurement is claimed. Reusing a frozen real
capture makes the timing oracle deterministic across platforms without a new capture harness.
