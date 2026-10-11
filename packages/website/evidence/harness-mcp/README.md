# The harness step says any agent that speaks MCP can use storytree's plan (increment_c7b27b8dd435)

ADR-1007 D5 (owner, 2026-10-11): a harness's mark appears only when storytree watches it and its setup check can verify it;
once the connected tier is built (increment_8412ba94175d, PR 1219), one line under the marks may say that any agent that
speaks MCP can use storytree's plan. Connected harnesses get no mark.

| Step | Under the marks | How |
|---|---|---|
| Works with your harness. | "Any other agent that speaks MCP can use the plan too." (DRAFT) | gains: "Any other agent that speaks MCP can connect to the server too: it gets the plan, claims and the library, though storytree doesn't watch its session." (DRAFT) |

**Pictures.** `before/` is `main` at 8ed1b753, `after/` this branch, at 1440×900 and 390×844 on SwiftShader, three seconds into
the harness step's line while it plays. `seen.json` records the card, the marks and the line. Made with
`node packages/website/evidence/harness-mcp/capture.mjs [--before]` after `pnpm --filter @storytree/website build`.

**Choices made here.** The line is data on the step (`marksNote` in `src/tour-copy.ts`), drawn under `#tour-marks` and hidden
with them, and in free play. It is quieter than the marks' names (regular weight, 15px, 14px on a phone).
