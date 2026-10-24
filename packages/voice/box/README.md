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
| `door-database.sql` | Makes the lock: the role may add a row and never remove one. |
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
