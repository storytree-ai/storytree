# Pending library update — own decision numbers (ADR-0662)

The laptop supervisor applies [changes.patch](changes.patch) after the code PR merges. It updates
**The library** (`story_754e87e7d531`), capability **13 · Decision log**
(`capability_78d6e026f902`), and **The command line** (`story_f9fb5136c28f`), capability
**6 · Decisions** (`capability_562b2527ebca`). The lane has made no live-library writes.

The old fields come from the read-only snapshot
`2026-09-27T14-03-38-576Z.json` (taken at `2026-09-27T14:03:38.710Z`). Paths identify
story/capability/record/field, not repository files. The library narrative's CRLF line endings
are shown as LF in the diff; its old wording is unchanged. Reconcile each field against the live
library before applying: preserve sibling edits, record IDs, other fields and shelf links. These
are six field replacements and three new contracts, with no decision or question record.

## Apply and read back the story changes

- [ ] Library capability 13: replace `capability_78d6e026f902` — `description`.
- [ ] Library contract 13.6: replace `contract_c759659246a2` — `title`.
- [ ] Library narrative: replace `definition_15f873f38fda` — `meaning`.
- [ ] Add contract 13.8 under `capability_78d6e026f902`, using the added title in the patch.
- [ ] Command-line capability 6: replace `capability_562b2527ebca` — `description`.
- [ ] Command-line contract 6.6: replace `contract_693fdb277bb9` — `title`.
- [ ] Command-line narrative: replace `definition_79d3c7b09427` — `meaning`.
- [ ] Add contract 6.9 under `capability_562b2527ebca`, using the added title in the patch.
- [ ] Add contract 6.10 under `capability_562b2527ebca`, using the added title in the patch.
- [ ] Read back every edited field and all three added contracts; verify IDs, sibling text,
  unrelated fields and shelf links survived.
- [ ] Confirm library contracts 13.5 and 13.7 and command-line contracts 6.7 and 6.8 still describe
  the separate Full record-only repair. This patch does not alter or weaken those contracts.
- [ ] Supervisor curation: read 0.3's imported ADR-0640 summary and correct any stale
  "until cutover" wording in place using the owner's existing ADR-0662 direction. Reconcile it
  with the live decision text and read it back; this hand-off authors no decision text and needs
  no new decision or question record.

The new setting stores the floor once in project history, so snapshots retain both the number and
the switch-on boundary. Founding books are the live decisions already present at that boundary
with no Full record line. Creation history orders their moves; completed moves and later decisions
are omitted. The existing imported-number repair stays available. No agent-role or decision-record
edit is included in the patch; the supervisor owns the curation above. Retirement of the one-time
verbs remains a later landing.

## Laptop command order after merge

- [ ] Confirm the code PR is merged and the laptop is running that merged 0.3 code.
- [ ] Read the unfiltered 0.2 decision log in its existing bookkeeping checkout with
  `pnpm storytree adr list`. Establish its actual final number at switch-on, including any
  allocation since ADR-0662, and stop allocating further numbers there.
- [ ] Replace **`FINAL_02_NUMBER`** below with that verified positive integer, at least 662.
  The value 662 was used only for the throwaway snapshot proof; it is not a live-library default.
- [ ] In the merged 0.3 checkout for project `storytree`, with its library running, execute the
  following commands in order. Review each preview before its corresponding apply.

```sh
pnpm storytree adr set-floor --number FINAL_02_NUMBER --dry-run
pnpm storytree adr set-floor --number FINAL_02_NUMBER --apply
pnpm storytree adr renumber --founding-books --dry-run
pnpm storytree adr renumber --founding-books --apply
pnpm storytree adr renumber --founding-books --dry-run
pnpm storytree adr list
```

- [ ] Verify the founding preview count against the live library. The supplied snapshot has 82
  decisions: 53 founding books and 29 Full record decisions. At floor 662, the proof moves the
  founding books to 663–715 and the next automatic decision is 716. A higher live floor or numbers
  allocated since the snapshot can raise those targets; explain any difference in the count.
- [ ] Verify the last founding preview shows `0 ready; 0 refused`. If any apply row is refused,
  read its reason: independent rows may have succeeded. Preview again and review the remaining
  rows before applying them. The floor cannot be reset or lowered.
- [ ] Verify original identities, links and old-number history remain, and Full record decisions
  retain their numbers. The next genuine `adr new` may omit `--number`; do not create a disposable
  proof decision in the live library.
- [ ] Apply and read back the story changes above, then close increment `increment_a24af47e59dd`
  on arc `arc_23442c993f25` with the merged PR and the supervisor's outcome.

The [evidence README](../README.md) links the command outputs and snapshot proof. Repeat and lower
floor refusals were exercised on that throwaway copy; they are not additional live commands.
