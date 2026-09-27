# ADR-0650: 0.3's library has no memory type, and its knowledge records are called artifacts

- **Front cover of:** stories/library.md, capability 6
- **Full record:** ADR-0650 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0650`)
- Copied in full; historical wording and the owner's quotations are preserved.

## Status

accepted (2026-09-27). The owner decided this in conversation on 2026-09-27, while reviewing the planet's knowledge core. His words: "so by notes you mean artifacts/library artifacts - not sure where this note terminology came from, have we transferred over 0.2 definitions? Arn't memories a claude code specific thing? i think in 0.2 we kept a process to promote them into the knowledge corpus but that doesnt make them part of the storytree system." Then: "M1, and switch the wording to artifact. We will want to bring the graduation into 0.3 at some point, i just lean more toward it not being needed for mvp right now". Design-time alignment IS the ratification (ADR-0110).

**Depends on** ADR-0621 and ADR-0627. This narrows a clause of each, and each carries an in-place annotation in this same landing:
- **ADR-0621's capability 6 row, "Knowledge and memory: memory notes, decisions and definitions".** There is no memory type.
- **ADR-0627 D4, "a new memory or definition links to the front cover this session most recently opened".** The default filing applies to the kinds that remain.

## Context

In storytree 0.2, a "memory" was Claude Code's own per-machine file. A librarian pass promoted the durable ones into library artifacts (a principle, a process, a definition) and deleted the file. Memory was never a kind of library artifact.

0.3 went further. The library's approved tree (ADR-0621, row 6) listed "memory notes", drafted by an agent. The library gained a `memory` record type, the agent link a write-memory tool, and ADR-0627 D4 a rule for filing a new memory behind the cover last opened. 0.3's librarian story also ports 0.2's graduation of Claude Code's memory folders. So a harness-specific concept lived inside storytree's own data model, beside the process meant to keep it out.

0.3 also adopted "note" as the umbrella word for its knowledge records. 0.2's word was "artifact".

## Decision

**D1 (M1): the library has no memory type.** Memory is the harness's business: Claude Code, Codex, or whatever the agent runs in.
- What an agent wants to keep in storytree, it writes as a proper artifact kind (a decision, definition, principle, guardrail, pattern, process, friction and so on), or not at all.
- The library's `memory` type goes, and the agent link's write-memory tool writes one of the proper kinds or refuses with the reason.
- Any memory records already written are converted to a proper kind where the text says which, and otherwise reported, never silently dropped.

**D2: the knowledge records are called artifacts.** Everything people and agents read says "artifact", not "note": story files, decision summaries, the app, the command line's output, the agent link's tool descriptions and its habits card. Code names such as `editNote` and `relatedNotes` change when they are next touched, not in a sweep.

**D3: graduation is not needed for the MVP.** The owner's lean: bringing 0.2's promotion of harness memories into 0.3 is wanted "at some point", but not now. The librarian's graduation functions, already built (`packages/librarian/src/graduation`), are not removed by this decision (ADR-0633: nothing that worked is cut without the owner's explicit decision). They are simply not MVP-critical, and no further graduation work is prioritised for the MVP.

## Consequences

- A build lane removes the memory type and switches the wording (`0-3-library-no-memory-type`, on `storytree-0-3-library-arc`). It touches the library, the agent link's tools and habits card, and the stories' and app's wording.
- **The planet's knowledge core loses a confusion.** No artifact sits "inside" a cover by pointing back at it as a memory. Depth follows what artifacts rest on, and ADR-0647, the core's approved tree, is annotated to match.
- **ADR-0627 D4's default filing now covers definitions and the other remaining kinds.** A new artifact still links to the cover the session last opened, when it names no place.

## References

- ADR-0621 (the library's tree), ADR-0627 (the rabbit-hole model), ADR-0633 (nothing cut without the owner), ADR-0644 (the librarian).
- 0.2's graduation process: the librarian pass that promotes agent memories into artifacts.
