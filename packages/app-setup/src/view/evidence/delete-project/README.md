# Delete a project, in the app menu (ADR-0831)

The actual desktop page (`node build.mjs`, then `node capture.mjs`), dark theme, headless Chromium,
with a fake bridge: no library is read or written. The project on show is `storytree`, so it is not
offered; `downloads` and `old-blog` are. The warning is the one a Cloud SQL library gives.

1. [At rest](1-projects-rest.png): "Delete a project's records…" sits below Remove.
2. [Open](2-dialog-open.png): the project, who loses it, the name box, the snapshot ticked; Delete for good is off.
3. [Half typed](3-name-half-typed.png): still off until the whole name is typed.
4. [Typed, snapshot unticked](4-name-typed-snapshot-skipped.png): Delete for good is on.
5. [Deleted](5-deleted.png): the dialog closes and says where the snapshot is.
6. [Refused](6-refused-live-claim.png): a live session's claim in the project; nothing is deleted.
7. [Narrow window](7-dialog-narrow.png).

Remove shows disabled in these pictures only because the fake bridge never reports a project on show to it.
