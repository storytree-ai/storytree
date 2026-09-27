## 4 · Arcs and increments

**As built — closing ends claims.** `storytree arc increment close <increment>
--disposition <landed|failed|withdrawn> [--pr <ref>] [--note <why>]` first closes the
increment through the library. After a successful close it calls the agent link's
public `closed` function, the same function used by `close_increment`. Its `closed`
activity line ends any claim on that increment, whoever holds it; it does not
release the closing session's other claims. A refused or missing increment writes
no closure line. The library retains its rules for the outcome, pull request and
note.

Closing still works from an agent's shell or a person's terminal. The closure
line names the agent session when present, otherwise `person:<computer-user>`;
the library history keeps its existing writer attribution.

**Contract 4.6.** Closing an increment ends its claim for any holder and outcome;
a refused close leaves it held. Proven by `packages/cli/src/arcs.test.ts`, test
4.6, including landed, failed and withdrawn outcomes, the holder, another agent,
a person, and a missing increment.

**Dependency addition.** The agent link's claims (capability 5), through its public
`closed` function. The CLI contains no second claim-ending rule.
