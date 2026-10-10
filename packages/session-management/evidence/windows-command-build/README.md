# Renewed Windows command-build timeout

Investigation for increment_e9700b147886, after PR #775 removed the redundant
host-launcher compile from the desktop delivery build.

## Existing native evidence

| Windows job | Delivery `buildBins`, ms | Built MCP smoke, ms | Result |
| --- | ---: | ---: | --- |
| [PR #840, first run](https://github.com/storytree-ai/storytree/actions/runs/37653398523/job/112902265039) | unfinished at the 60 s test deadline | 71,679, timed out | Delivery, MCP, desktop capture and CLI unit failed |
| [PR #840, later head](https://github.com/storytree-ai/storytree/actions/runs/37659884533/job/112924381995) | 3,239 | 10,720 | All three platform jobs passed |
| [Merge queue](https://github.com/storytree-ai/storytree/actions/runs/37661779580/job/112930845759) | 5,856 | 16,336 | These proofs passed; an unrelated library test failed |
| [Main c85c4cb2](https://github.com/storytree-ai/storytree/actions/runs/37662391124/job/112932925776) | 3,105 | 12,171 | All three platform jobs passed |

These are existing tests under each job's concurrent package load, not isolated
benchmarks. The first failed delivery child loaded helpers in 8,370 ms, started
`buildBins`, and was aborted at parent elapsed 59,972 ms. Cleanup finished at
60,106 ms. The log cannot distinguish esbuild from native probe staging inside
`buildBins`; the host launcher was already disabled in this caller. Coincident
timeouts in other packages do not establish a shared cause.

The later jobs do not reproduce a persistent command-build regression. They do
not establish why the earlier runner stalled, or prove the delay cannot recur.
There is no evidence for increasing the deadlines or changing database fixtures.

## Change

`buildBins` now reports synchronous START/PASS/FAIL observations to stderr for
JavaScript bundling, native probe staging, and the optional Windows launcher.
Thus a process killed mid-build retains the last phase it entered, without
writing diagnostics into an MCP protocol stream. These measurements include
runner scheduling and filesystem delays; they do not isolate CPU time.

The existing built MCP smoke names its build, protocol and stdin-close phases.
It builds with `launcher: false`: the harness starts the `.mjs` with Node, so a
Windows command launcher is not part of this proof. The default production build
and setup/launcher proofs still compile it. Tool discovery, real stdin/stdout
transport, server exit, native inference, and all deadlines remain intact.

No new product behavior or test framework is introduced. The existing timeout
is the failure evidence; the existing behavior tests validate the change. No
speedup or causal explanation of the original stall is claimed.
