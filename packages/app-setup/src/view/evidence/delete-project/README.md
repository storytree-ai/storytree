# Delete a project, in the app menu (ADR-0831)

The actual desktop page (`node build.mjs`, then `node --import tsx capture.mjs`), dark theme, headless Chromium,
with a fake bridge: no library is read or written. The project on show is `storytree`, so it is not
offered; `downloads` and `old-blog` are. The warning is the one a Cloud SQL library gives.

1. [At rest](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app-setup/src/view/evidence/delete-project/1-projects-rest.png): "Delete a project's records…" sits below Remove.
2. [Open](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app-setup/src/view/evidence/delete-project/2-dialog-open.png): the project, who loses it, the name box, the snapshot ticked; Delete for good is off.
3. [Half typed](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app-setup/src/view/evidence/delete-project/3-name-half-typed.png): still off until the whole name is typed.
4. [Typed, snapshot unticked](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app-setup/src/view/evidence/delete-project/4-name-typed-snapshot-skipped.png): Delete for good is on.
5. [Deleted](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app-setup/src/view/evidence/delete-project/5-deleted.png): the dialog closes and says where the snapshot is.
6. [Refused](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app-setup/src/view/evidence/delete-project/6-refused-live-claim.png): a live session's claim in the project; nothing is deleted.
7. [Narrow window](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app-setup/src/view/evidence/delete-project/7-dialog-narrow.png).

Remove shows disabled in these pictures only because the fake bridge never reports a project on show to it.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 7 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app-setup/src/view/evidence/delete-project).
