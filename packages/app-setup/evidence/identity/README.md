# Optional feedback account — 2026-10-06

Contract 5.5: the real feedback component offers an optional identity bridge only on the feedback page. First run does not query identity. Signing in alone attaches nothing. A separate Add account to message action inserts the verified email and portable Storytree ID into the editable message; the user can remove it before copy or browser handoff. A failed sign-in leaves feedback usable and hides upstream error details.

The initial mounted tests failed on the absent identity behavior. Both now pass. `capture.mjs` mounts that same component in Chromium with an explicit fixture account and fake browser/copy actions. It checks signed-out use, explicit sign-in, visible attribution, removal, exact handoff text and no horizontal overflow at 380 pixels. It stops its browser and loopback server and deletes temporary files. No social sign-in or GitHub issue submission occurs.

Pictures for review: [signed out](signed-out.png), [account in the editable message](reviewed-account.png), [narrow window](narrow.png). They use the existing desktop palette and control styles; the form keeps account details beside the message the user is reviewing. These are component captures, not a deployed desktop or live staging acceptance.

The shipped desktop supplies no `feedbackIdentity` bridge yet, so its feedback behavior stays account-free. Wiring the official desktop SDK and the bridge through preload/renderer requires the separate integration increment beyond track S's write fence.
