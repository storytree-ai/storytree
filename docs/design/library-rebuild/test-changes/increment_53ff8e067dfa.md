# Test changes: commands (increment_53ff8e067dfa)

Changes beyond re-pointed imports, for the blind reviewer. Every copied title, contract number and assertion is
unchanged, and every file's tests are in their frozen order.

1. Files carried whole, each under its own name: `verbs/verb.test.ts` (16.1–16.4) to `commands/kit/`;
   `commands/commands.test.ts` (all 38: the 17.x tests and the one 14.19) and `commands/media.test.ts` (17.18) to
   `commands/`; `data/data-questions.test.ts` (27.1–27.6) to `commands/queries/`; `decisions/adr.test.ts` (all twelve:
   13.10, 13.11, 13.16, 13.17, 13.20–13.25, 13.27, 13.28) to `knowledge/decisions/`; `work/question-seal.test.ts`
   (12.14) to `work/inbox/`.
2. The leading `// Capability …` line is dropped from all six files (ADR-1369, no comments). None had another comment.
3. Imports re-pointed (old path → rebuild path, relative to each file's new folder):
   - `../verbs/verb.js` (the command kit) → `commands/kit/index.js` (`./index.js` in `verb.test.ts`, which imported
     `./verb.js`; `./kit/index.js` from `commands/`; `../kit/index.js` from `commands/queries/`;
     `../../commands/kit/index.js` from `knowledge/decisions/` and `work/inbox/`).
   - `./stale-edit.js` (`RECENT_MS`, `refuseStaleEdit`) → `./kit/stale-edit.js`: the stale-edit refusal is kit code
     shared by every edit verb.
   - `./ranked.js` (`narrowedSaid`) → `./ranked.js`, unchanged: it stays in `commands/`.
   - `../commands/index.js` (`LIBRARY_FAMILIES`, `NOTE_TOOLS` and the context types) → the commands entry,
     `commands/index.js` (`../index.js` from `commands/queries/`, `../../commands/index.js` from
     `knowledge/decisions/` and `work/inbox/`). `data-questions.test.ts` takes `LIBRARY_FAMILIES` from the commands
     entry, not from the saved queries' own `commands/queries/index.js`, which none of the copied tests imports.
   - `../knowledge/index.js` (`ARTIFACT_KINDS`) → the notes entry, `../knowledge/notes/index.js`, which already
     exports it.
   - `../project/index.js` (`connect as connectProject`) → the opening domain's `projects/open/index.js`.
   - `../api/index.js` (`type Library`, in `verb.test.ts`) and `../index.js` (`connect`, `type Library`) → the package
     root, `src/index.ts` (`../../index.js` from `commands/kit/`, `commands/queries/`, `knowledge/decisions/` and
     `work/inbox/`; `../index.js`, unchanged, from `commands/`).
   - `../testing/pg.js` → the copied `src/testing/pg.ts`, at the depth of each file's folder.
   - `adr.test.ts`'s `./index.js` (`ADR_FAMILY`) stays `./index.js`: the decisions entry.
4. `knowledge/decisions/supersede.test.ts`: the three tests the decisions lane left to this increment (its ledger,
   item 5) are put back verbatim at their frozen positions: the two 13.13 verb tests ("a decision superseded by
   `adr new --supersedes`…", "a decision superseded through `library new`, `library edit` or `adr push`…") after the
   third 13.12 test and before the 13.13 part-way test, and 13.14 ("a new decision written proposed…") last. Its
   imports gain exactly what those three use, in the frozen file's layout: `mkdtempSync`, `readFileSync`,
   `writeFileSync`, `tmpdir`, `path`, `LIBRARY_FAMILIES` and `type LibraryVerbContext` (commands entry),
   `type DoorWords` and `type VerbContext` (kit entry), and `ADR_FAMILY` (beside `supersede`, from `./index.js`). The
   13.12 tool test and its `librarianTools`, `ToolAnswer` and `ToolCall` stay out: the librarian increment carries it
   (`knowledge/librarian/supersede.test.ts`). The file now differs from the frozen one only by the dropped comment
   line, the re-pointed imports and that tool test.
5. Nothing was left out: every test of the six files and the three supersede tests is carried. No `testing/` file was
   changed or copied; no helper was added.
6. Seen red, every file failing to load (the expected red: the modules do not exist yet): `commands/kit/index.js`
   cannot be found (verb, commands, media, data-questions, adr, question-seal); `supersede.test.ts` fails on
   `./index.js` not providing `ADR_FAMILY`. No copied test passes on arrival. The four supersede tests the decisions
   lane carried, green before, now fail to load with the file until `ADR_FAMILY` and `LIBRARY_FAMILIES` exist.
7. Export keys the builder adds for these entries (`packages/library/package.json`'s, targets in the new tree):
   `./verbs` → `./src/commands/kit/index.ts`, `./commands` → `./src/commands/index.ts`.
8. A gap of the frozen oracle the test review found (review 1, test slice, hit 4939), left as it is because this arm
   copies tests and adds none: contract 17.39 (contract_a530455d1108, `library new <kind>` given `--arc` or
   `--increment` for a kind with no such field writes it in that arc's or increment's library with no such field
   stored, while a kind that has the field still stores it) has no frozen test (`oracle-01600d97.json` holds no 17.39,
   and no `17.39 ·` title is in `packages/library/src`), and it is not in `spec/17.txt`, which ends at 17.38: it was
   written on 2026-11-26 at 13:57, after the snapshot. The code reaching it (`commands/kit/where.ts`) is covered only
   by the frozen tests that drive where a write goes; 17.39's own case is unobserved here.
