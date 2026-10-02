# Automatic queue publication — 2026-10-02

Chapter 1's PR [#503](https://github.com/storytree-ai/storytree/pull/503) merged at 03:58:53 UTC
as `124d21fb8dbdbafc5d443aff8773222092f13a9c`, after three automatic paths missed it:

- [PR CI 36962265210](https://github.com/storytree-ai/storytree/actions/runs/36962265210)
  finished at 03:57:00; [its publication run](https://github.com/storytree-ai/storytree/actions/runs/36962394027)
  stopped looking at 03:58:17, 36 seconds before the queue merge.
- [Queue CI 36962398897](https://github.com/storytree-ai/storytree/actions/runs/36962398897)
  succeeded on that exact merge SHA. Its event was `merge_group`, branch
  `gh-readonly-queue/main/pr-503-4558b679060cd175c220a9b07416a1b55c13a88b`, and PR list empty.
  [Its publication run](https://github.com/storytree-ai/storytree/actions/runs/36962504416)
  rejected the unsupported event at 03:58:48, five seconds before merge.
- [Main CI 36962528150](https://github.com/storytree-ai/storytree/actions/runs/36962528150)
  was cancelled, so it could not recover publication.

The originally reported skipped runs [36962561447](https://github.com/storytree-ai/storytree/actions/runs/36962561447)
and [36962990348](https://github.com/storytree-ai/storytree/actions/runs/36962990348) confirm the
symptom, but their original nested event payloads were not available. Their outer workflow-run
head is the selector checkout; it is not proof of the source CI event. No exact source-run
association is claimed for those two runs.

The repaired selector uses the commit-to-PR API for queue events as it already did for PR CI.
It waits for a same-repository PR into main whose merged SHA exactly equals the queue's
successful tested SHA. It then fetches main again before checking ancestry, so the checkout
made before the merge does not incorrectly reject it. Unmerged/mismatched/failing/foreign
runs still cannot select a publication. Live-version comparison, unchanged-site suppression,
newer-website-input suppression and the second ancestry check at publication remain in place.

Contract 4.3's regression uses the actual Chapter 1 queue SHA and PR head and was observed
red, then green. The selector was also replayed read-only using the real successful queue
run for snapshot PR #510. This invoked only `source`, with output under /tmp; no manual
publication or workflow change was used.
