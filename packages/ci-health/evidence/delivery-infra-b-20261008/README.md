# Independent delivery-infra challenge B

The health-only SQL role can influence owner decision numbering under the authored grants. Two other implementation defects reproduce, but their proposed security impact still lacks a demonstrated lower-trust deployment. This is evidence only; no product implementation or live configuration changed.

| Candidate | Adjudication | Evidence and limit |
| --- | --- | --- |
| delivery-infra-001 | Confirmed, conditional on access as the restricted SQL role | Real PostgreSQL RLS and the original allocator queries/function: next number 11 becomes 701 after a health event reserves 700; direct decision writes remain denied. Deployment and credential compromise unverified. |
| delivery-infra-002 | Performance defect confirmed; security impact unverified | Actual package checker: 4/8/12-node acyclic graphs cause 15/255/4095 visits. No stress test or operational lower-trust consumer demonstrated. |
| delivery-infra-003 | Manual-handler path escape confirmed; cross-user disclosure unverified | Seven extracted handlers return an adjacent synthetic marker; the primary guarded helper returns 403. Same UID only; these helpers are not the deployed website. |

`independent-result.json` was fixed at 2026-10-08T01:00:04.353749Z, SHA-256 `2e1ccfa8d42fc19949ef2fb32937b12be3eb46c63fb8ba363854d33e0d48ab04`, before reading review A or reconciliation. `adjudication.json` records the later comparison: no substantive disagreement. The original B job remains failed; `original-b-failure.json` preserves its safeguard error. No flagged request was relaunched, no provider or safeguard changed, and no access purchase occurred.

Source commits at review time: original `08124e6286ff09843500a35120a38a685806a646`; then-current main `a29b7f1b4f41dab3d99455bea0a3d1de679bd4be`. Relevant handlers/allocator/graph logic were unchanged between those commits. The source manifest names exact repository paths, commands and hashes; source citations and job-local test artifacts are separate.

Executed command on Mint:

```text
python3 /home/mickh/storytree-security-reviews/20261007-mint-08124e62/jobs/challenge-delivery-infra-b-6d02e377b3fa-20261008/run-probe.py
```

It exited 0. `probe-20261008T005801Z.run.json` carries the complete sandbox command and script hashes. Its stdout JSONL contains each PostgreSQL command, SQL input, exit code, stdout/stderr and observations. Six exit-3 RLS controls are expected denials. The test scripts are archived unchanged; `source-manifest.json` describes the source inputs retained in the additive job directory. This archive does not duplicate repository source. Reproduction requires reconstructing `sources/original` and `sources/current` from the manifest's pinned `git show` commands and the specified Mint runtimes; the scripts are not CI test infrastructure.

Isolation: `bwrap --unshare-all`, environment cleared, read-only selected source/runtime, disposable tmpfs, a private PostgreSQL Unix socket and namespace-private loopback. No real credentials, host-data probes, browsers, cloud services or live databases were used. The temporary PostgreSQL process was stopped and the sandbox exited. The top-level `Knowledge.recordDecision` propagation is source proof; PostgreSQL RLS, its actual allocator queries and the exported numbering calculation were executed. Neither this review nor its PR proves a remediation.

Review A's original scripts and outputs were inspected and hashed; `prior-tests-checked.json` retains the two failed graph-instrumentation attempts as failures. A's pure allocator probe and the reconciler's memory-backend probe did not execute PostgreSQL. The new test supplies that narrower missing execution evidence without claiming live exposure.

Follow-up: existing library remediation `increment_bcef77287a8d` is supported by this adjudication and becomes ready when this review closes. Since the review, guardrails work `increment_f73e0a95b027` landed in [PR #868](https://github.com/storytree-ai/storytree/pull/868), and website helper containment `increment_6dc5e158e4cf` landed in [PR #862](https://github.com/storytree-ai/storytree/pull/862). Their merged status does not supply independent remediation verification in this archive. The explicitly retired forest-world helper remains named conditional residue; a separate session is not justified unless it is reused. The parent reconciliation and final remediation verification remain separate work.

Landing continuation: session `01a119bd-4e3e-7e12-803c-3548514384ff` recovered the pending archive on main `9280c366e7624dddb842cc8209049edcaecfa504`. It verified the original artifact hashes and pinned source bytes, and recorded the changed source files in `landing-provenance.json`. It did not author another independent verdict or rerun the historical probes. The dated verdict and adjudication remain byte-identical; their use of “current” means the review-time commit above. `orientation.json` and `relevant-source-diff.run.json` preserve the referenced setup and source-comparison command; its raw diff stdout remains in the full additive job. That raw diff contains whitespace-only context lines and is not reformatted or duplicated here. The continuation changes this README and adds provenance only.

Full additive job: `/home/mickh/storytree-security-reviews/20261007-mint-08124e62/jobs/challenge-delivery-infra-b-6d02e377b3fa-20261008`. Original report and original reviewer outputs were not overwritten. No owner question was needed. Friction and health drains were empty; no decision, role or guidance changed, so curation had nothing to amend.
