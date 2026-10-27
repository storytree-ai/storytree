# The voice door, confined (capability 4)

`confine.sh` moves the voice door off the owner's account on the Mint box. That account is a Postgres
superuser and holds the GitHub and SSH keys. The door moves onto:

- its own system user, `storytree-voice`, at home in `/var/lib/storytree-voice`;
- its own node and repository copy;
- its own database role, `storytree_voice`, which may read only what the door reads (contract 4.3).
  It may also add to the search cache (4.4);
- its own database, `storytree-voice`, holding the lock that turns voice writes off (4.5);
- confined system units (4.6).

The script is the owner's to run, because sudo and database roles are his (ADR-0928 D5, ADR-0939). It deletes nothing.

| File | What it does |
|---|---|
| `role.sql` | Makes the role and the door's database. The role has a password and signs in over 127.0.0.1 only. |
| `library-grants.sql`, `activity-grants.sql`, `trunks-grants.sql` | The role's reads, measured by running every command the door runs as a role granted exactly these (`src/role.test.ts`). |
| `door-database.sql` | Makes the lock: the role may add a row and never remove one. Also the drafts and notes of voice writes and the FYIs heard by voice (capability 5); safe to run again, and it brings a table an earlier copy made up to date. |
| `trunk-approval.sql` | Approves the door's copy as a checkout. It is the trunk of its own machine id, so the owner's checkout stays the trunk on his. |

Why a password and not the local socket: the storytree command line reaches a library only by a
`postgres://` address naming a host, and it refuses a `host=` socket path. So the role cannot use peer
sign-in. Its password is kept only in the door's storytree home (0600, its user's), and `pg_hba.conf`
refuses the role from anywhere but 127.0.0.1.

## Running it (PowerShell 5.1 on the laptop)

```powershell
ssh -t mint "cd ~/code/storytree03; sudo bash packages/voice/box/confine.sh --dry-run"
ssh -t mint "cd ~/code/storytree03; sudo bash packages/voice/box/confine.sh"
```

The last step checks the work. The service should show `User=storytree-voice` and `ProtectHome=yes`.
The door should answer a bare 404 outside its route. `question list` should answer as the door's user.
The role's rights should read `reads t`, `writes f`, `lock_add t`, `lock_clear f` and `superuser f`.
The script ends by printing the rollback and the kill switches.

`/etc/storytree-voice/env` gets only the door's own settings from the spike's env file: its secret,
`PORT`, `ALLOWED_HOSTS` and `ALLOWED_CIDRS` (contract 4.7). A path in that file, such as its
`REPO_DIR`, would override the unit's own and point under a home folder the door cannot see.
If the confined door is not running and answering five seconds after the cut-over, the script stops
it and turns the owner's user units back on, so the connector is never left down.

Step 3's install warns `Failed to create bin ... @storytree/cli/dist/storytree.mjs`. It does not
matter: that file exists only after a build, and the door runs the command line from its source
through tsx, never through that link.

## Voice writes (capability 5)

Voice writes are drafts in `voice_draft` (`door-database.sql`): the door's role may add one and set only
its confirmed and cancelled times, and the database sets every time itself. A draft lapses 15 minutes
after it is read back unless confirmed. A session manager run is read back in one line ("Sending 2 notes
and your request about …: say yes to send.") and takes effect the moment it is confirmed, with no window
(ADR-1155 D3); cancel stops it only until the run starts. A note (`save_note`) is a row of kind `note`,
kept at once with no read-back; an answer to an open question is a note too. The confined door never
writes the library: confirming a run makes the database notify `voice_run`, and `voice-listen.service`,
the owner's account listening on the door's database over the local socket, runs one tick of the
committer each time, so the run starts within seconds through `~/storytree-lanes/run-lane.sh`, its files
in `~/storytree-lanes/voice-runs/`. A run's end mark appearing there wakes it too, so the reply is
recorded at once. It ticks on every (re)connection, catching up on what it missed, and reconnects after
losing the database; `voice-commit.timer` runs the same tick every 15 minutes as a fallback. Once the
checkout it runs from moves to another commit, the listener ticks no more and exits, and systemd starts it
again on the current code. Each run is its own user unit, `voice-run-<id>` (started with `systemd-run --user`,
seen with `systemctl --user status voice-run-<id>` and `journalctl --user -u voice-run-<id>`), so it outlives the
tick that launched it: a child of the timer's oneshot tick died with the tick (draft 11, 2026-10-25). A run whose
unit stopped without marking its end is recorded ended without a reply on the next tick, and the box takes the
next run; the hand-made `~/.config/systemd/user/voice-commit.service.d/keep-runs.conf` that kept runs alive is no
longer needed. A run that fails to start ends as failed, its reply saying it never started, so
catch_up reads it and the box takes the next run. The run's
brief carries every note not yet swept, and the committer marks those notes swept by that run
(`swept_by_run`, which only the owner's account may set) as it starts it; the run acts on each, answers
included. The scheduled session manager sweeps the leftovers between voice runs, marking each note it
takes `swept_by = 'scheduled YYYY-MM-DD'` (again the owner's account only); a note with either mark, or an
outcome, is never carried by a run again. It runs one voice-started run at a time, and never waits on the
scheduled session manager.
While `voice_lock` holds a row it drops what is waiting.

Turning them on, after the change lands and the door's refresh has taken it (within 15 minutes), as the owner on the box:

```bash
cd ~/code/storytree03 && git pull && pnpm install
sudo runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d storytree-voice < packages/voice/box/door-database.sql
mkdir -p ~/.config/systemd/user && cp packages/voice/box/voice-{commit.service,commit.timer,listen.service} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now voice-listen.service voice-commit.timer
echo VOICE_WRITES=on | sudo tee -a /etc/storytree-voice/env && sudo systemctl restart storytree-voice
```

## Voice from the factory (contract 4.10)

`to-factory.sh` switches the confined door to the voice plugin in the owner's factory repo
(`HuaMick/storytree-factory`, `plugins/voice`), after `confine.sh`. Run it once the door's copy has taken
the change that adds it (its refresh does that within 15 minutes of the merge):

```bash
cd ~/code/storytree03 && git pull
sudo bash packages/voice/box/to-factory.sh --dry-run
sudo bash packages/voice/box/to-factory.sh
```

The first run makes a read-only deploy key that only the door's user holds (`/var/lib/storytree-voice/.ssh`).
It stops there, printing the key and how to add it to the repository (Settings > Deploy keys, write access
left unticked). Run it again once the key is added. It then:

1. clones the factory into the door's default factory folder, `/var/lib/storytree-voice/storytree/your-factory`,
   links the door's base copy in as its `storytree` folder, and installs it;
2. writes units that run the door's code through the link `/var/lib/storytree-voice/voice`, points the link
   at the base copy's voice and proves the door answers, putting the old units back if it does not;
3. switches the door's only part to the plugin (`voice-host part voice plugin voice`). The refresh points
   the link at the plugin and restarts the door. If the door does not answer, it switches back at once.

From then on the refresh keeps both the base copy and the factory clone at their `main`. The base copy is
still needed for storytree's command line, which the door runs. `sudo bash packages/voice/box/to-factory.sh --back`
switches the door back to the base copy's voice while storytree still ships it.
