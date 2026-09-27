# Filing cap evidence

Increment: `increment_2abc492c87a8`.

`red.txt` records the pushed red commit `3ee7584`: the CLI and MCP both accepted a fourth friction report. The green implementation enforces the cap in shared capture, stamps branch/date/source provenance, counts routed reports, and points to reinforcement when full. Reports from another day or branch do not consume the allowance.

Reference: frozen 0.2 `packages/cli/src/friction.ts`, lines 267–269 and 310–322. Date is UTC `toISOString().slice(0, 10)`; the cap is three for the matching provenance branch/date, including routed reports. No reference behavior was intentionally left out.

Tests use real Postgres and the built CLI/MCP surfaces. The CLI also proves refusal leaves history unchanged, routed reports count, reinforcement remains available, and a different branch can file. MCP proves the calling folder's branch reaches the same check, including an unborn Git branch.

Library updates: `../library-update/filing-cap.patch` and `filing-cap-checklist.md`. No live library writes were made.
