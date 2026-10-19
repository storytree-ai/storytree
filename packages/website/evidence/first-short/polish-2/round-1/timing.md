# Round 1: the script's timing

56 s at 30 fps; the end card from 52 s. Cuts (either half): 1.50, 10.00, 11.00, 15.00, 15.50, 17.40, 19.00, 22.00, 23.00, 32.60, 34.50, 36.50, 37.50, 39.50, 41.00, 42.00, 43.00, 45.00, 48.00, 49.00, 52.00.

## Without storytree (left half)

| from | to | view | screen | pose | what happens |
| --- | --- | --- | --- | --- | --- |
| 0.00 | 1.50 | room | claude | typing |  |
| 1.50 | 10.00 | full | claude | typing | types "add a wishlist to the shop"; Claude: "done: shoppers can save items for later. 9 files changed." |
| 10.00 | 11.00 | room | code src/routes/wishlist.ts | reading |  |
| 11.00 | 15.00 | full | code src/routes/wishlist.ts | reading | thinks "ok. what did it build?" |
| 15.00 | 19.00 | full | code src/wishlist/store.ts | reading | thinks "so this saves the list..." |
| 19.00 | 22.00 | full | code src/cart/move.ts | reading | thinks "and this moves it?" |
| 22.00 | 23.00 | room | claude | typing |  |
| 23.00 | 32.60 | full | claude | typing | types "ok so the wishlist thing you built. not the page with the..." (349 chars); Claude: "which one: move in cart, or the button?" |
| 32.60 | 36.50 | full | claude | reading | thinks "let me look." |
| 36.50 | 37.50 | room | code src/cart/move.ts | reading |  |
| 37.50 | 41.00 | full | code src/cart/move.ts | reading | thinks "this one, i think." |
| 41.00 | 42.00 | room | claude | typing |  |
| 42.00 | 48.00 | full | claude | typing | types "the cart one i think"; Claude: "and should it stay on the wishlist after?" |
| 48.00 | 49.00 | room | code src/wishlist/store.ts | reading |  |
| 49.00 | 52.00 | full | code src/wishlist/store.ts | reading | thinks "let me check..." |

## With storytree (right half)

| from | to | view | screen | pose | what happens |
| --- | --- | --- | --- | --- | --- |
| 0.00 | 1.50 | room | claude | typing |  |
| 1.50 | 10.00 | full | claude | typing | types "add a wishlist to the shop"; Claude: "done: shoppers can save items for later. 9 files changed." |
| 10.00 | 11.00 | room | map | typing |  |
| 11.00 | 15.50 | full | map | typing | clicks the island, its panel opens |
| 15.50 | 17.40 | full | graph | typing |  |
| 17.40 | 19.00 | full | graph | typing | thinks "looks about right. let me just check one thing." |
| 19.00 | 22.00 | room | graph | leaning | thinks "looks about right. let me just check one thing." |
| 22.00 | 23.00 | room | claude | typing |  |
| 23.00 | 34.50 | full | claude | typing | types "wishlist / 4 · move to cart: does it empty the list?"; Claude: "no: it moves the item to the cart and keeps it on the list. no test yet." |
| 34.50 | 39.50 | full | claude | typing | types "good. now build sharing a list."; Claude: "on it." |
| 39.50 | 41.00 | room | claude | standing |  |
| 41.00 | 43.00 | room | claude | walking |  |
| 43.00 | 45.00 | room | claude | gone |  |
| 45.00 | 52.00 | full | claude | gone |  |

## Lines a viewer must read, and how long each is held

Reading time is words / 2.5 + 1 s.

| half | line | shown from | to | held | needs |
| --- | --- | --- | --- | --- | --- |
| without | add a wishlist to the shop | 3.37 | 10.00 | 6.63 | 3.40 |
| without | done: shoppers can save items for later. 9 files changed. | 3.97 | 10.00 | 6.03 | 5.00 |
| without | ok. what did it build? | 11.00 | 15.00 | 4.00 | 3.00 |
| without | so this saves the list... | 15.00 | 19.00 | 4.00 | 3.00 |
| without | and this moves it? | 19.00 | 22.00 | 3.00 | 2.60 |
| without | which one: move in cart, or the button? | 31.93 | 36.50 | 4.57 | 4.20 |
| without | let me look. | 32.60 | 36.50 | 3.90 | 2.20 |
| without | this one, i think. | 37.50 | 41.00 | 3.50 | 2.60 |
| without | the cart one i think | 42.33 | 48.00 | 5.67 | 3.00 |
| without | and should it stay on the wishlist after? | 42.97 | 48.00 | 5.03 | 4.20 |
| without | let me check... | 49.00 | 52.00 | 3.00 | 2.20 |
| with | add a wishlist to the shop | 3.37 | 10.00 | 6.63 | 3.40 |
| with | done: shoppers can save items for later. 9 files changed. | 3.97 | 10.00 | 6.03 | 5.00 |
| with | Wishlist | 13.07 | 15.50 | 2.43 | 1.40 |
| with | 4 · Move to cart | 15.50 | 19.00 | 3.50 | 3.00 |
| with | looks about right. let me just check one thing. | 17.40 | 22.00 | 4.60 | 4.60 |
| with | wishlist / 4 · move to cart: does it empty the list? | 24.73 | 39.50 | 14.77 | 5.80 |
| with | no: it moves the item to the cart and keeps it on the list. no test yet. | 25.37 | 39.50 | 14.13 | 7.80 |
| with | good. now build sharing a list. | 35.53 | 39.50 | 3.97 | 3.40 |
| with | on it. | 36.13 | 39.50 | 3.37 | 1.80 |
| with | write src/wishlist/share.ts | 45.30 | 52.00 | 6.70 | 1.80 |
| with | write src/wishlist/share.test.ts | 46.20 | 52.00 | 5.80 | 1.80 |
| with | run tests: 31 passed | 47.10 | 52.00 | 4.90 | 2.60 |
| with | update the map: 5 · share link | 48.00 | 52.00 | 4.00 | 3.80 |
