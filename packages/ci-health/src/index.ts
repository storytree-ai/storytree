// Capability 3 · Reading the project's CI. CI health (ADR-0901, ADR-0902): a project's verified health, read from the test results its own CI produced, or a factory plugin's, from a run of its own tests (capability 4, ADR-1186), or a project's, from a local run of its own tests (capability 5, ADR-1193).
// Recording a run of a project's tests (storytree's own health among them, ADR-1066 D2 G) is Mick's dev loop's
// (packages/repo-checks/src/test-run, ADR-1170 D3), which reaches the verdict rules and the verified-column writer here.
export * from "./run-results/run-results.js";
export * from "./verdicts/verdicts.js";
export * from "./read-ci/read-ci.js";
export * from "./read-ci/record.js";
export * from "./plugin-run/plugin-run.js";
export * from "./local-run/local-run.js";
