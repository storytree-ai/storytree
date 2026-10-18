# Round 5: the script's timing

56 s at 30 fps; the end card from 52 s. Cuts (either half): 1.50, 10.00, 11.00, 15.00, 18.50, 19.00, 22.00, 23.00, 32.60, 34.50, 36.50, 37.50, 39.50, 40.50, 41.00, 42.00, 45.00, 48.00, 49.00, 52.00.

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
| 23.00 | 32.60 | full | claude | typing | types "ok so the waitlist thing you built. not the page, the par..." (358 chars); Claude: "which one: check.ts or the handler in main.ts?" |
| 32.60 | 36.50 | full | claude | scratching | thinks "uh..." |
| 36.50 | 37.50 | room | code src/waitlist/check.ts | scratching |  |
| 37.50 | 41.00 | full | code src/waitlist/check.ts | scratching | thinks "the check, maybe?" |
| 41.00 | 42.00 | room | claude | typing |  |
| 42.00 | 48.00 | full | claude | typing | types "the check i think"; Claude: "and should it match the email exactly, or ignore case?" |
| 48.00 | 49.00 | room | code src/waitlist/store.ts | scratching |  |
| 49.00 | 52.00 | full | code src/waitlist/store.ts | scratching | thinks "hang on..." |

## With storytree (right half)

| from | to | view | screen | pose | what happens |
| --- | --- | --- | --- | --- | --- |
| 0.00 | 1.50 | room | claude | typing |  |
| 1.50 | 10.00 | full | claude | typing | types "add a waitlist to the website"; Claude: "done: a form, a store and a page. 7 files changed." |
| 10.00 | 11.00 | room | map | typing |  |
| 11.00 | 19.00 | full | map | typing | clicks the island, its panel opens |
| 19.00 | 22.00 | room | map | leaning | thinks "looks almost right." |
| 22.00 | 23.00 | room | claude | typing |  |
| 23.00 | 34.50 | full | claude | typing | types "the website / 5 · waitlist: does it stop duplicate emails?"; Claude: "yes: one row per email. a repeat is ignored, but case still counts." |
| 34.50 | 39.50 | full | claude | typing | types "good. now build the welcome email."; Claude: "on it." |
| 39.50 | 40.50 | room | claude | standing |  |
| 40.50 | 42.00 | room | claude | walking |  |
| 42.00 | 45.00 | room | claude | gone |  |
| 45.00 | 52.00 | full | claude | gone |  |

## Lines a viewer must read, and how long each is held

Reading time is words / 2.5 + 1 s.

| half | line | shown from | to | held | needs |
| --- | --- | --- | --- | --- | --- |
| without | add a waitlist to the website | 3.60 | 10.00 | 6.40 | 3.40 |
| without | done: a form, a store and a page. 7 files changed. | 4.20 | 10.00 | 5.80 | 5.40 |
| without | what did it build? | 11.00 | 15.00 | 4.00 | 2.60 |
| without | which part is the form? | 15.00 | 18.50 | 3.50 | 3.00 |
| without | what calls this?! | 18.50 | 22.00 | 3.50 | 2.20 |
| without | which one: check.ts or the handler in main.ts? | 32.13 | 36.50 | 4.37 | 4.20 |
| without | uh... | 32.60 | 36.50 | 3.90 | 1.40 |
| without | the check, maybe? | 37.50 | 41.00 | 3.50 | 2.20 |
| without | the check i think | 42.30 | 48.00 | 5.70 | 2.60 |
| without | and should it match the email exactly, or ignore case? | 42.90 | 48.00 | 5.10 | 5.00 |
| without | hang on... | 49.00 | 52.00 | 3.00 | 1.80 |
| with | add a waitlist to the website | 3.60 | 10.00 | 6.40 | 3.40 |
| with | done: a form, a store and a page. 7 files changed. | 4.20 | 10.00 | 5.80 | 5.40 |
| with | The website | 13.07 | 19.00 | 5.93 | 1.80 |
| with | 5 · Waitlist | 13.07 | 19.00 | 5.93 | 2.20 |
| with | looks almost right. | 19.00 | 22.00 | 3.00 | 2.20 |
| with | the website / 5 · waitlist: does it stop duplicate emails? | 24.93 | 39.50 | 14.57 | 5.40 |
| with | yes: one row per email. a repeat is ignored, but case still counts. | 25.53 | 39.50 | 13.97 | 6.20 |
| with | good. now build the welcome email. | 35.63 | 39.50 | 3.87 | 3.40 |
| with | on it. | 36.23 | 39.50 | 3.27 | 1.80 |
| with | edit src/waitlist/store.ts | 45.30 | 52.00 | 6.70 | 1.80 |
| with | write src/waitlist/welcome.ts | 46.30 | 52.00 | 5.70 | 1.80 |
| with | run tests: 19 passed | 47.30 | 52.00 | 4.70 | 2.60 |
| with | update the map: 5 · waitlist | 48.30 | 52.00 | 3.70 | 3.40 |
