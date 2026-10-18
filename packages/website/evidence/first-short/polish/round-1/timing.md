# Round 1: the script's timing

56 s at 30 fps; the end card from 52 s. Cuts (either half): 1.50, 10.00, 11.00, 15.00, 18.50, 19.00, 22.00, 23.00, 29.20, 34.50, 35.50, 39.50, 40.50, 42.00, 46.50, 47.00, 48.00, 52.00.

## Without storytree (left half)

| from | to | view | screen | pose | what happens |
| --- | --- | --- | --- | --- | --- |
| 0.00 | 1.50 | room | claude | typing |  |
| 1.50 | 10.00 | full | claude | typing | types "add a waitlist to the website"; Claude: "done: a form, a store and a page. 7 files changed." |
| 10.00 | 11.00 | room | code src/main.ts | scratching |  |
| 11.00 | 15.00 | full | code src/main.ts | scratching | thinks "what did it build?" |
| 15.00 | 18.50 | full | code src/waitlist/store.ts | scratching | thinks "which part is the form?" |
| 18.50 | 22.00 | full | code src/waitlist/check.ts | scratching | thinks "what calls this?!" |
| 22.00 | 23.00 | room | claude | typing |  |
| 23.00 | 29.20 | full | claude | typing | types "ok so the waitlist thing you built. not the page, the par..." (358 chars) |
| 29.20 | 34.50 | full | claude | typing | thinks "uh..."; Claude: "which one: check.ts or the handler in main.ts?" |
| 34.50 | 35.50 | room | code src/waitlist/check.ts | scratching |  |
| 35.50 | 39.50 | full | code src/waitlist/check.ts | scratching | thinks "the check? i think?" |
| 39.50 | 40.50 | room | claude | typing |  |
| 40.50 | 47.00 | full | claude | typing | types "the check i think"; Claude: "and should it match the email exactly, or ignore case?" |
| 47.00 | 48.00 | room | code src/waitlist/store.ts | scratching |  |
| 48.00 | 52.00 | full | code src/waitlist/store.ts | scratching | thinks "hang on..." |

## With storytree (right half)

| from | to | view | screen | pose | what happens |
| --- | --- | --- | --- | --- | --- |
| 0.00 | 1.50 | room | claude | typing |  |
| 1.50 | 10.00 | full | claude | typing | types "add a waitlist to the website"; Claude: "done: a form, a store and a page. 7 files changed." |
| 10.00 | 11.00 | room | map | typing |  |
| 11.00 | 19.00 | full | map | typing | clicks the island, its panel opens |
| 19.00 | 22.00 | room | map | leaning | thinks "looks almost right." |
| 22.00 | 23.00 | room | claude | typing |  |
| 23.00 | 34.50 | full | claude | typing | types "the website 5 · waitlist: does it stop duplicate emails?"; Claude: "yes: one row per email. a repeat is ignored, but case still counts." |
| 34.50 | 39.50 | full | claude | typing | types "good. now build the welcome email."; Claude: "on it." |
| 39.50 | 40.50 | room | claude | standing |  |
| 40.50 | 42.00 | room | claude | walking |  |
| 42.00 | 46.50 | room | claude | gone |  |
| 46.50 | 52.00 | full | claude | gone |  |

## Lines a viewer must read, and how long each is held

Reading time is words / 2.5 + 1 s.

| half | line | shown from | to | held | needs |
| --- | --- | --- | --- | --- | --- |
| without | add a waitlist to the website | 3.60 | 10.00 | 6.40 | 3.40 |
| without | done: a form, a store and a page. 7 files changed. | 4.20 | 10.00 | 5.80 | 5.40 |
| without | what did it build? | 11.00 | 15.00 | 4.00 | 2.60 |
| without | which part is the form? | 15.00 | 18.50 | 3.50 | 3.00 |
| without | what calls this?! | 18.50 | 22.00 | 3.50 | 2.20 |
| without | uh... | 29.20 | 34.50 | 5.30 | 1.40 |
| without | which one: check.ts or the handler in main.ts? | 29.20 | 34.50 | 5.30 | 4.20 |
| without | the check? i think? | 35.50 | 39.50 | 4.00 | 2.60 |
| without | the check i think | 40.80 | 47.00 | 6.20 | 2.60 |
| without | and should it match the email exactly, or ignore case? | 41.40 | 47.00 | 5.60 | 5.00 |
| without | hang on... | 48.00 | 52.00 | 4.00 | 1.80 |
| with | add a waitlist to the website | 3.60 | 10.00 | 6.40 | 3.40 |
| with | done: a form, a store and a page. 7 files changed. | 4.20 | 10.00 | 5.80 | 5.40 |
| with | The website | 13.23 | 19.00 | 5.77 | 1.80 |
| with | 5 · Waitlist | 13.23 | 19.00 | 5.77 | 2.20 |
| with | looks almost right. | 19.00 | 22.00 | 3.00 | 2.20 |
| with | the website 5 · waitlist: does it stop duplicate emails? | 26.50 | 34.50 | 8.00 | 5.00 |
| with | yes: one row per email. a repeat is ignored, but case still counts. | 27.10 | 34.50 | 7.40 | 6.20 |
| with | good. now build the welcome email. | 35.93 | 39.50 | 3.57 | 3.40 |
| with | on it. | 36.53 | 39.50 | 2.97 | 1.80 |
| with | update the map: 5 · waitlist | 47.50 | 52.00 | 4.50 | 3.40 |
