/** Capability 11 · Pipeline wiring: the workflow wire_pipeline writes, from the jobs the parts it is given contribute. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { storytreeRef, workflowFor } from "./pipeline.js";

test("11.8 a contributed job that needs the history checks it out with origin/main, so the self-equal assertion check compares the change with it", () => {
  const job = { name: "storytree check", needsHistory: true, commands: () => ["true"] };
  const workflow = workflowFor({ test: "npm test", systems: ["linux"], ref: "main", jobs: [job] });
  const written = workflow.slice(workflow.indexOf("  storytree-check:"));
  assert.match(written, /- uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}persist-credentials: false\n {10}fetch-depth: 0\b/, written);
});

test("11.10 the workflow wire_pipeline writes runs with read-only repository permissions, keeps no checkout credentials, uses every action at a pinned commit, and takes storytree's source at the full commit of the user's release", () => {
  const job = { name: "storytree check", needsHistory: true, commands: (ref: string) => [`echo ${ref}`] };
  const workflow = workflowFor({ test: "npm test", systems: ["linux", "windows"], ref: "main", jobs: [job] });
  assert.match(workflow, /^permissions:\n {2}contents: read$/m, workflow);
  const uses = workflow.split("\n").filter((line) => line.includes("uses:"));
  assert.equal(uses.length, 4, workflow);
  for (const line of uses) assert.match(line, /uses: actions\/[a-z-]+@[0-9a-f]{40} # v\d/, line);
  assert.equal(workflow.match(/persist-credentials: false/g)?.length, 2, "both checkouts keep no credentials");

  const commit = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(storytreeRef({ version: "0.3.42", commit }), commit);
  assert.equal(storytreeRef(undefined), "main", "run from source, it follows main");
});
