# Supervisor checklist

- [ ] Confirm that #154's and #155's library-update patches were applied. This patch's old descriptions are those prepared results; compare with the live records before applying.
- [ ] Apply changes.patch to capability_611029207d9a and capability_f3a301d328cd descriptions.
- [ ] Keep contracts 3.5/3.6 and the front-door increment open: this landing completes shared stop authority and dependencies, not installed doors.
- [ ] Carry the fence/identity residue in ../README.md onto arc_197b9208adfc. No question or decision was written by this lane.

The supplied 2026-09-27 snapshot predates the own story and ADR-0727. Record IDs and old text came from the committed #154/#155 hand-offs, not a live-store read. No new contracts are needed for the shared authority correction; it protects existing 3.5/4.1.
