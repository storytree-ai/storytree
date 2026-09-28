# Embedding runtime delivery proof

Increment `increment_bdc06eae9c0f`, arc `arc_cfc7db517fae`.

The desktop stages Transformers 4.3.0, ONNX Runtime 1.30.0 CPU binaries and the required Sharp
0.35.5 dependency for each Windows target. All modules sit beside `storytree.mjs` and
`storytree-mcp.mjs`; no loader or ranking behaviour changes. Runtime licenses ship with them.
GPU providers, browser WASM files and model weights are not staged. The existing model download
and `<storytree home>/models` cache remain first-use behaviour.

## Evidence

- [red.txt](red.txt): the new delivered-layout runtime check fails because Transformers is absent.
  Red commit: `ceb32f6`; the test was run against that pushed revision before staging was added.
- [green.txt](green.txt): Linux native CPU inference succeeds from an unrelated installed-layout
  directory with empty PATH/NODE_PATH and no loader options. The 75-byte Identity graph has no
  weights and returns 42. The normal CLI, hook, setup, delivery and MCP checks also pass.
- [typecheck.txt](typecheck.txt): all workspace typechecks pass.
- [staging.txt](staging.txt): both real staged Windows ONNX binding/DLL pairs have the expected
  PE machine, and the payload manifests include the runtime files. ARM64 is inspected, not executed.
- [test-ratio.txt](test-ratio.txt): `all 43,088 36,935 1.17` (test lines, implementation lines, ratio).
- [library-update/](library-update/): pending story patch and application checklist for the supervisor.

`pnpm gate` also passed typecheck and all affected test units; guidance was NOT RUN because no
agent role or supporting note changed. Heavy work used `/tmp/storytree-heavy.lock`.

## Delivery size

| Target | Added runtime files | Added bytes | Added MiB |
| --- | ---: | ---: | ---: |
| Windows x64 | 211 | 53,373,626 | 50.90 |
| Windows arm64 | 211 | 51,767,506 | 49.37 |
| Both architecture payloads | 422 | 105,141,132 | 100.27 |

These are exact added, uncompressed runtime bytes (licenses included), excluding the small
payload-manifest growth. They are not a measurement of compressed installer growth. Sharp is a
mandatory Transformers import even for text embeddings, accounting for about 19.8/17.0 MB of
x64/arm64 native dependencies. No bge-small weights were downloaded or bundled by this lane.

## Held on the file fence

[payload-blocker.txt](payload-blocker.txt) records the unchanged delivery verifier rejecting
`node_modules/@huggingface/transformers/LICENSE`. Its allowed path characters omit `@`.
The fix is outside the lane's explicitly named paths:

- `packages/app-setup/src/deliver/payload.ts`
- `packages/app-setup/src/deliver/delivery.test.ts`

[pending-verifier.patch](pending-verifier.patch) is the exact proposed change, **not applied**:
allow `@` while retaining traversal, absolute-path and checksum checks, and exercise a scoped
runtime package in the existing payload-integrity test. The lane requested the narrow scope
extension. Until it is authorized and applied, the installer proof is expected to fail and this
work must remain unmerged. There is no Windows execution claim yet. No decision or question
record was written, and the supervisor retains the claim and increment closure.
