# Verified health is dropped from the MVP

- **Front cover of:** none
- **Full record:** ADR-0630 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0630`)

No MVP story runs a user's tests: health shows what the agent reports, labelled as the agent's.

The planned story "work model with verified health", in which storytree runs a landed part's tests
itself, left the MVP, and its lane closed with nothing built. In the MVP, a contract's health is what
the agent reported through the agent link. The library keeps every red and green report in order, so
a view can show that a contract went red before it went green.

The library keeps its verified column as built. Nothing writes it for users' projects in the MVP, so
there it reads "not checked"; this repo's own seed still writes it for storytree's own stories, from
their test runs. Enforcing CI in users' projects is a later idea, out of the MVP, and how it would
work is not decided. Cutover no longer waits on verified health.

Why: storytree re-running the agent's own tests cannot catch a test bent to pass, and neither can CI.
0.2's real problem was tests that were never seen to fail, not tests nobody ran. What re-running
would add, a check for projects with no CI, did not outweigh its costs: a change to the data schema,
a test runner that must behave on Windows, and storytree running agent-written code outside the
agent's own permission prompts. The cost accepted: the MVP has no independent check of users'
projects.
