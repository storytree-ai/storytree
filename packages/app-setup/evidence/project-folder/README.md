# Project folder (ADR-0752)

- Increment 1, increment_03faf35c540d: the installer asks for the project folder; sessions outside a project stay silent.
  - `red.txt`: the new tests failing before the change (8.12 silence, check_setup's non-project text, the add-project logic, the installer's folder step).
  - `helper-live.txt`: the bundled delivery helper (`storytree-deliver.mjs`, built as the release builds it) inspecting and setting up a folder with spaces against a throwaway local Postgres: a refused name, a set-up, a repeat that creates nothing.
  - `library-update/`: contract text for the supervisor.
- Increment 2, increment_14f177725450: Add project from the app, with a folder picker.
  - `red-add-project.txt`: the add-project action missing before the change.
  - `capture.mjs`: the built desktop renderer headless, with the app setup's real add-project action on a throwaway Postgres and a scripted folder (`My Second Site`) standing in for the native picker. It asserts the button is in Projects, the added project is shown and both are selectable, and that adding the same folder again creates nothing. Pictures: `projects-add-button.png`, `projects-after-add.png`, `help-add-a-project.png` (the guide's three ways). The Electron `dialog.showOpenDialog` itself is not driven here.
- Live check on the Windows laptop (v0.3.271): `live/README.md`. The installer's folder step and Add project with the real folder dialog passed; the two real Claude Code sessions were not run because Claude Code there is signed out.
