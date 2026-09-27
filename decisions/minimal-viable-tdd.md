# Minimal viable TDD

- **Front cover of:** none
- **Full record:** ADR-0623 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0623`)

A test earns its place by protecting something the product does: write the minimum test that goes red.

The unit of testing is the product behaviour a contract names. A test does not take as its subject a
decision record, a retirement (that a removed feature stays removed), the wording of prose or source
text, or the structure of the repository. A regression test for a real incident protects a
behaviour and is welcome; it names the incident, so a later writer can judge whether the behaviour
still exists. The tie-break: if the behaviour disappeared, would this test fail? If it would fail
only when a file, a word or a decision changed, it is out.

Red still comes first: every behaviour gets its failing test, committed and seen failing, before the
code that makes it pass. The rule "minimum test to red" is the red side's twin of "minimum source to
green". It limits how many tests there are and what they are about; every test that is written must
still be strong.

Deleting is part of the job. When work passes through a test file, the writer removes a test whose
behaviour it has just pinned more directly, or whose subject is one of those left out above. No
sweep is chartered: removal rides along with real work.

No new testing machinery (a gate step, a checker, a harness or a fixture framework) enters 0.3 unless
a named product behaviour cannot be proven without it. The one instrument is a report, `pnpm
test-ratio`: test code per line of implementation, read at each landing, and never a gate.

Why: in 0.2, test code outgrew product code (1.40 lines of test per line of code, rising) because
every guard added pushed toward more tests and nothing subtracted. 0.2's own suite is left as it is.
