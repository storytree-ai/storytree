# Lanes roll up their increments and fold under what they wait on — ADR-0760 D1

The actual desktop renderer, captured unedited with headless Chromium 148 over an isolated Postgres
(the 2026-09-27 snapshot supplies the forest; the arcs are an explicit fixture). Dark theme,
1440 × 960. Nothing in the owner's library or running app is opened or changed.

- [Folded: the lamp and its follow-on sit behind the caret](folded.png)
- [Queue open: chips under their blocker](queue-open.png)
- [A queued arc selected from its chip](queued-selected.png)
- [Measured results](capture.json)

The fixture: *Trusted-circle distribution* has free work (**ready · 2 to take**). *Floor-health
lamp*'s only open increment waits on that arc's *First trusted-circle users*, so it reads queued and
folds under it; *Lamp tips in the briefing* waits on the lamp's increment, so the two form a chain.
*Choose the release approach* also waits on *First trusted-circle users* but has a question for the
owner, so it stays at the top reading **waiting**. *Cloud backups* waits on work in a parked arc,
off this board, so it stays at the top reading **queued** and names what it waits on. *Arc surface*
is claimed, for contrast.

Reproduce from the repository root:

```sh
flock /tmp/storytree-heavy.lock node apps/desktop/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/arc-surface/evidence/lane-rollup/capture.mjs <snapshot.json>
```

The renderer now also reads its surfaces setting and opens its app menu when the app's own reads
are absent; this capture answers the first as "unread" (every surface on) and closes the menu. The
older `../capture.mjs` predates both and no longer reaches a ready page.
