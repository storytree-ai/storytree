/**
 * Capability 4 · Updates. `storytree release pin`, declared once (ADR-0969 D2, ADR-1033): the owner pins one of the
 * builds already published as stable, or previews its landed-increment notes; nothing else promotes (4.16). The command
 * line mounts it as its `release` family (RELEASE_FAMILIES); it has no tool.
 */
import { verb, type VerbFamily } from "@storytree/library/verbs";

const pin = verb({
  command: { family: "release", name: "pin", summary: "pin the owner's chosen published build as stable, preview its landed-increment notes, or move stable back to a build pinned before", usage: "release pin <0.3.n> [--preview] [--back | --expedited <why>]" },
  tool: { absent: "pinning stable is the owner's own act, taken from his shell" },
  inputs: {
    version: { kind: "text", word: 0, describe: "the owner's chosen release" },
    preview: { kind: "switch", describe: "preview the release notes and publish nothing" },
    back: { kind: "switch", describe: "move stable back to this build, pinned before, to stop a bad pin spreading" },
    expedited: { kind: "text", optional: true, describe: "why this urgent fix is pinned without the 24-hour soak; the notes say so first" },
  },
  async act(input, context) {
    const [{ pinRelease }, { pinCoverage }] = await Promise.all([import("./stable-github.js"), import("./stable-pin.js")]);
    const pin = await pinRelease(input.version, { cwd: context.folder, library: context.library, preview: input.preview, back: input.back,
      ...(input.expedited ? { expedited: input.expedited } : {}) });
    const done = input.back ? "Stable is moved back to" : "Stable is pinned to";
    return { text: `${input.preview ? "Preview of" : done} storytree ${pin.version}. ${input.preview ? "Nothing was published." : "The original installers are unchanged."}\n${pinCoverage(pin)}\n\n${pin.releaseNotes}` };
  },
});

const candidate = verb({
  command: { family: "release", name: "candidate", summary: "name the newest published build fit to pin as stable, with its evidence and what passed over each newer one; changes nothing", usage: "release candidate" },
  tool: { absent: "it is read before the owner's own pin, from his shell or the fortnightly routine" },
  inputs: {},
  async act(_input, context) {
    const { findStableCandidate } = await import("./stable-github.js");
    const found = await findStableCandidate({ cwd: context.folder, library: context.library });
    const passed = found.passedOver.map(b => `  ${b.version}: ${b.reasons.join("; ")}`);
    const head = found.candidate
      ? [`Stable candidate: storytree ${found.candidate.version} (stable is ${found.pinned ?? "not pinned yet"}).`, ...found.candidate.evidence.map(e => `  ${e}`)]
      : [`No build newer than stable's ${found.pinned ?? "(none pinned)"} is fit to pin yet.`];
    return { text: [...head, ...(passed.length ? ["", "Passed over, newest first:", ...passed] : []),
      ...(found.candidate ? ["", `Pin it with: storytree release pin ${found.candidate.version}`, "", found.candidate.notes] : [])].join("\n") };
  },
});

/** The command line's `release` family, at its place among `storytree`'s families. */
export const RELEASE_FAMILIES: readonly VerbFamily[] = [
  { name: "release", summary: "find, pin or move back the build stable installations take", order: 12, verbs: [candidate, pin] },
];
