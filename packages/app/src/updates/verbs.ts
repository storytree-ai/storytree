/**
 * Capability 4 · Updates. `storytree release pin`, declared once (ADR-0969 D2, ADR-1033): the owner pins one of the
 * builds already published as stable, or previews its landed-increment notes; nothing else promotes (4.16). The command
 * line mounts it as its `release` family (RELEASE_FAMILIES); it has no tool.
 */
import { verb, type VerbFamily } from "@storytree/library/verbs";

const pin = verb({
  command: { family: "release", name: "pin", summary: "pin the owner's chosen published build as stable, or preview its landed-increment notes", usage: "release pin <0.3.n> [--preview]" },
  tool: { absent: "pinning stable is the owner's own act, taken from his shell" },
  inputs: {
    version: { kind: "text", word: 0, describe: "the owner's chosen release" },
    preview: { kind: "switch", describe: "preview the release notes and publish nothing" },
  },
  async act(input, context) {
    const [{ pinRelease }, { pinCoverage }] = await Promise.all([import("./stable-github.js"), import("./stable-pin.js")]);
    const pin = await pinRelease(input.version, { cwd: context.folder, library: context.library, preview: input.preview });
    return { text: `${input.preview ? "Preview of" : "Stable is pinned to"} storytree ${pin.version}. ${input.preview ? "Nothing was published." : "The original installers are unchanged."}\n${pinCoverage(pin)}\n\n${pin.releaseNotes}` };
  },
});

/** The command line's `release` family, at its place among `storytree`'s families. */
export const RELEASE_FAMILIES: readonly VerbFamily[] = [
  { name: "release", summary: "pin the owner's chosen existing build for stable installations", order: 12, verbs: [pin] },
];
