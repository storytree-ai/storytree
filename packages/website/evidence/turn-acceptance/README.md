# The turn keeps its frames (1.9), recorded as an acceptance run

2026-10-09, Mint box, increment_945f37220e0c. Contract 1.9 is checked only in the browser, by `--verify-opening-frames`
(`../opening.mjs`, SwiftShader); the capture now writes its verdict beside 2.10's, so `pnpm record:acceptance` records it.

Built from c2869cc7 (`WEBSITE_SHA`), the turn handed over in 1,161 ms, its longest frame 300 ms; 1.9 and 2.10 passed
(`opening-frames.json`, `opening-frames-observations.json`).

## Reproduce

    WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter ./packages/website build
    node packages/website/evidence/capture.mjs turn-acceptance --verify-opening-frames
    pnpm record:acceptance packages/website/evidence/turn-acceptance/opening-frames-observations.json

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 2 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/turn-acceptance).
