# History tab (forest 7.21–7.23)

The sessions strip's History tab, on the actual desktop page (built by `../sessions-list/build.mjs`) with synthetic activity:
two sessions at work now, and five that have left the live list across today, yesterday and four days ago.
Run: `node ../sessions-list/build.mjs && node --import tsx capture.mjs --retake`.

| Picture | What it shows |
| --- | --- |
| `history-live-tab.png` | The Live tab as before, with the new Live / History tabs in the header. |
| `history-today.png` | History, Today: the two sessions that left today, latest first, each led by how it ended. |
| `history-seven-days.png` | 7 days chosen: landed with its pull requests, held with its question, closed out, ended without a close-out. |
| `history-row-selected.png` | A history row selected: the knowledge core selects its session as a live row's click does (7.7). |
| `history-row-selected-strip.png` | The strip alone with that row marked selected. |

The capture asserts that the globe above the strip is pixel-identical before and after opening History and after
choosing a range (7.22), and that clicking the selected row again lets the selection go (7.23).

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 5 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/history-tab).
