# The project's sentence moves from the map into Settings → Projects (app setup 3.9)

Owner, 2026-10-21: "The project definition sentence shouldnt be displayed, this belongs in settings against the project that you have selected."

Before (the forest's old anchor-line capture, contract 3.67, now retired):
- `before-forest-sentence.png`: the sentence drawn at the top of the map.
- `before-forest-unsaid.png`: the map naming what the anchor had not said.

After (`node build.mjs`, then `node --import tsx capture.mjs --retake`, on the actual desktop page with a stand-in bridge):
- `after-forest-no-sentence.png`: the map with the project's anchor written, and no sentence drawn (the capture fails if `.forest-anchor` is on the page).
- `after-1-settings-unsaid.png`: Settings → Projects for a project with no sentence: both halves shown as not said yet.
- `after-2-settings-half-typed.png`: one half typed; Save is offered.
- `after-3-settings-saved.png`: both halves saved.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 6 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app-setup/src/view/evidence/project-sentence).
