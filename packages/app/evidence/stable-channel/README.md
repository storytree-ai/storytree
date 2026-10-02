# Owner-pinned stable releases

ADR-0871; increment `increment_f0a8ea4485f9`. Updates contracts 4.15–4.16 and delivery contract 1.10.

After the owner names an existing release, preview its notes from a storytree checkout:

```sh
pnpm storytree release pin 0.3.N --preview
```

When the owner says to pin that version, run the same command without `--preview`. It requires `gh` signed in with repository contents write access. A pin accepts only a complete published release carrying the channel-aware delivery manifest. Pre-channel releases are refused because their app cannot retain stable identity.

The `release-channel-stable` branch contains only the update manifest, its published bootstrap and notes. It has no application source. Its fast-forward-only reference update exposes the feed and bootstrap together, refuses overlapping publication, and retains earlier pin notes in history. The feed points at the original release installer with its original size and SHA-512; no installer is rebuilt or copied. Development keeps publishing each verified merge as GitHub's latest release.

The stable installation command is in `install-storytree.txt`; the explicit development command is in `install-storytree-development.txt`. Stable delivery is unavailable until the owner makes the first pin. A missing or unreadable stable feed never falls back to development. An installation's `release-channel.json` lives in its app home. A saved channel wins on restart/reinstall; legacy NSIS installations retain development, and fresh installations default stable. Quiet-hours/manual timing from PR #531 applies to both.

Notes include landed increment records whose PR actually merged into the selected build. Previously included record IDs prevent duplicates; a closure recorded after the preceding pin is included on the next one. Mentioning another PR in a commit message does not count as shipping it.

## Proof and limits

- Red commits: `40e065a3` (stable selected development), `ff4bc6d2` (delivery channel/metadata missing), `c4ab4d66` (atomic publication missing), `58040ead` (exact merged-PR selection missing).
- App tests use real electron-updater feed/download/digest handling with fixture installer bytes; they never execute NSIS. Channel persistence and pin validation/history/concurrency tests pass.
- Delivery tests run real PowerShell. Mint used `/tmp/storytree-pwsh/pwsh` via `STORYTREE_TEST_PWSH`; Windows CI runs both stock PowerShell 5.1 and PowerShell 7.
- No live stable pin was published by this lane. Real Windows installation, legacy upgrade, next pin, overnight quiet hours and manual installation are recorded as laptop residue `increment_b51a820db8b2` on `arc_a4a987f828dc`.
