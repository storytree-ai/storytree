# App setup 1.6: an existing storytree command is kept and named (increment_d1c604205018, ADR-0825 D5)

Contract 1.6: "The installed command runs from a fresh Windows terminal; an existing unrelated `storytree`
command is preserved and the conflict is named." The first-run journeys (../acceptance-run,
../acceptance-run-codex) see its first clause; this journey provokes its second, then sees the first again. The
harness, never a model, mints the verdict from what it observed; `pnpm record:acceptance <observations.json>`
writes it to the verified column as "acceptance run".

## The journey (harness/)

- `conflict.ps1`, in the owner's desktop session on the Windows test laptop (process_81a7122f6849), started by
  `../acceptance-run/harness/run-task.ps1 <stamp> 10 conflict.ps1`. It plants a dummy `storytree.cmd` of the
  user's own in `~\.local\bin`, a folder on the user's PATH ahead of storytree's (and refuses to run if one is
  already there). Then, with the PATH a fresh terminal gets, it runs the installed app's own installer finish
  step (`storytree-deliver.mjs finish`, exactly as `install.ps1` runs it) and `storytree doctor` from the
  installation, as `install.ps1` does when it reports a conflict. Then a fresh PowerShell says which storytree
  commands it finds and what `storytree` runs. The dummy is always removed (in a `finally`); with it gone, a
  fresh PowerShell finds storytree's command and its doctor's exit code is kept.
- `observe.mjs` turns the raw outputs into checks, reading only what the installer step, doctor, PowerShell and
  the file hashes said. It voids a run that did not finish or that the app updated during.

## Run of 2026-10-01 (2026-10-01/, stamp cf01)

Laptop `micksoldlaptop`, Windows 11 x64; storytree 0.3.414 (built from e221468e8451) before and after.

| Contract | Verdict | What the harness saw |
|---|---|---|
| 1.6 the command runs from a fresh terminal; an existing unrelated one is preserved and the conflict named | **passing, 7/7** | The installer's finish step reported `conflict`, naming `C:\Users\mickh\.local\bin\storytree.cmd` (`install.ps1` prints this as "An existing storytree command was preserved: …"). The dummy and storytree's own launcher were byte-identical afterwards. `storytree doctor` said "there is a storytree of your own on your path, so storytree's was not put there". A fresh PowerShell still ran the dummy. With the dummy removed, a fresh PowerShell found `~\.storytree\0.3\bin\storytree.cmd` and `storytree doctor` exited 0. |

The first reading of this run marked the doctor check failed: the observer looked for the setup check's
internal sentence ("There is already a storytree command of the user's own …"), while `storytree doctor`
prints its own wording, quoted above, which names the same conflict. The observer was corrected to doctor's
words; the run was not repeated, since no output changed.

The finish step also rewrote `~\.storytree\0.3\delivery.json`, as every installation does; it still names the
installed app.

## Left on the laptop

`../acceptance-run/harness/state.ps1` read the same before and after the run: the owner's `~\.codex`
(file hashes), Claude Code's and Codex's hooks and tool servers, the `storytree` command (file and body), the
user's PATH, the app's version, no scheduled task, no process. The dummy command was gone (`dummy-left.txt`:
False), `~\.local\bin` holds only what it held before, and the run's folder was deleted.
