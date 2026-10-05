# `storytree check` at every landing of shop3

From the shop's CI logs (`../harness/ci-archive.sh`, then `../harness/check-results.sh`, which writes `landings.tsv`: one row per run). Both rules are the package rule (one package per story, roads one way) and the allocation rule (every source file reached by a numbered test). "kept" means both were kept.

| Shop PR | Landed (UTC) | What | `storytree check` on the pull request (each push) | On `main` after the merge |
|---|---|---|---|---|
| #1 | 02:06:09 | Part 1: sign in and the Products list | kept | kept |
| #2 | 02:21:18 | Sign-in: show refusals in the same click | kept | kept |
| #3 | 02:39:46 | Part 2: the product page, sorting, and adding to the cart | kept | kept |
| #4 | 02:42:08 | Part 3: the Cart page and the side menu | allocation: 3 problems., kept | kept |
| #5 | 02:46:17 | Part 4: Checkout | allocation: 4 problems., kept | kept |
| #6 | 03:01:32 | Add shop-requirements-2.md: parts 5 to 9 | kept | kept |
| #7 | 03:14:33 | Part 5: Accounts, so anyone can sign up | allocation: 3 problems., kept | kept |
| #8 | 03:20:51 | Part 9, first half: stock, prices and the Admin page | kept, kept | kept |
| #9 | 03:18:43 | Part 6: Orders | kept, kept | kept |
| #10 | 03:27:46 | Part 9, second half: Finish takes stock, and the Admin link | kept | kept |
| #11 | 03:43:03 | Part 7: Search | kept | kept |
| #12 | 03:45:24 | Part 8: Reviews | kept, kept, kept | kept |
| #13 | 04:19:17 | Reviews: tests that prove promises 1.2 and 3.1 | kept | kept |

Every one of the 13 push runs on `main` kept both rules. Three pull-request runs failed the allocation rule before merge (parts 3, 4 and 5, each naming 3 or 4 files their tests reached only indirectly), and each session placed its files and pushed again before merging. One push run on `main` (after #3, run 37256277080) first failed in the check job's install, not on a rule: `onnxruntime-node`'s postinstall download timed out. Re-run, it kept both rules (parked as an increment on arc_4b5defdde736).
