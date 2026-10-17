// Capability 3 · Reading the project's CI. CI health (ADR-0901, ADR-0902): a project's verified health, read from the test results its own CI produced or from a
// run of its tests (test-run/, storytree's own health among them, ADR-1066 D2 G).
export * from "./run-results/run-results.js";
export * from "./verdicts/verdicts.js";
export * from "./read-ci/read-ci.js";
export * from "./test-run/record.js";
