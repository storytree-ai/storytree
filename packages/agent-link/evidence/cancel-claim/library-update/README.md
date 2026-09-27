# Supervisor library update

Apply [changes.patch](changes.patch) to the laptop's `storytree` library after the PR merges.
These are library field paths, not repository files. No live library was read or changed here.
Existing wording comes from the read-only 2026-09-27T14-03-38-576Z snapshot. Contract 6.20 is
reserved for PR #137's queued edit cancellation; this patch adds 5.15 and 6.21.

- [ ] Read the current records and reconcile later edits before replacing each complete field.
- [ ] Extend claims as-built `definition_f606731fb8c5.meaning` and tool writer as-built
      `definition_1655f6d65a9c.meaning`, preserving the patch's old wording and newer live changes.
- [ ] Add contract 5.15 under `capability_7077da59ee64` and 6.21 under
      `capability_11fe600afeda`; check current numbering first. Tests use these numbers.
- [ ] Read back each changed field and both contracts to verify persistence.
- [ ] Close `increment_c411e66ff4f9` on `arc_cfc7db517fae` with the merged PR and outcome;
      release the supervisor's remaining claim if needed.

The shared claim path admits a proposed/ready increment through the library lock before
appending its claim. Capabilities and active increments check cancellation under the activity
lock. An admitted operation completes even after cancellation. Tool-called audit lines remain;
this contract forbids claimed lines and work mutations from cancelled queued requests.

No decision or question record is requested. No agent role or standing guidance changed, so
no decision-log curation or guidance regeneration is needed. No friction/re-steer item arose.
