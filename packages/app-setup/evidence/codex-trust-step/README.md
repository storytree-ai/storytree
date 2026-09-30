# Codex's hook trust step, shown where the user looks (increment_1c5f35121647)

Codex runs storytree's hooks only once the user trusts them ("Hooks need review" when Codex starts, or
`/hooks`), and storytree cannot read that trust: Codex keeps it as hashes of its own (none of ten
plausible serialisations of a hook reproduced a `trusted_hash` on the owner's laptop, 2026-09-30). So
the proof is an event: a Codex hook that runs leaves a note in the storytree home (agent link 3.18), and
Codex's hooks read as running while that note is newer than their `hooks.json`.

Where the user now sees it, with the same one step (`CODEX_TRUST_STEP`):

| Where | Waiting | Running |
|---|---|---|
| `storytree setup connect --codex` and the installer's connect step (app setup 2.6) | "Codex: tools connected; hooks waiting for you to trust them in Codex." then the step | "Codex: tools connected; hooks running." |
| The setup check: check_setup, `storytree doctor`, the app's "Check a folder…" (agent link 8.16) | `codex-hooks · needs-attention`, fix: the step | `codex-hooks · ok` |
| check_setup in a Codex session whose hooks have not fired (fix `codex-approval`) | "Tell the user, in these words:" then the step | n/a |
| The app's Help → First-run guide, each time it opens (app setup 3.5) | `guide-codex-waiting.jpg` | `guide-codex-running.jpg` |

The pictures are the real Help panel (`mountSetupHelp`, the shipped `styles.css`) in a browser with a
stub bridge answering each state, captured before landing. The live laptop run on a release is recorded
with increment_1a9ed0ac26e6's.
