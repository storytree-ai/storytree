# Project folder (ADR-0752)

- Increment 1, increment_03faf35c540d: the installer asks for the project folder; sessions outside a project stay silent.
  - `red.txt`: the new tests failing before the change (8.12 silence, check_setup's non-project text, the add-project logic, the installer's folder step).
  - `helper-live.txt`: the bundled delivery helper (`storytree-deliver.mjs`, built as the release builds it) inspecting and setting up a folder with spaces against a throwaway local Postgres: a refused name, a set-up, a repeat that creates nothing.
  - `library-update/`: contract text for the supervisor.
