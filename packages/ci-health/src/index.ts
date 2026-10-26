// Capability 3 · Reading the project's CI. CI health (ADR-0901, ADR-0902): a project's verified health, read from the test results its own CI produced.
// Recording a run of a project's tests (storytree's own health among them, ADR-1066 D2 G) is Mick's dev loop's
// (packages/dev-loop/src/test-run, ADR-1170 D3), which reaches the verdict rules and the verified-column writer here.
export * from "./run-results/run-results.js";
export * from "./verdicts/verdicts.js";
export * from "./read-ci/read-ci.js";
export * from "./read-ci/record.js";
