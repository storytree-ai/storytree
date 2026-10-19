/**
 * Capability 1 · Home page. The words of the tour's last two opening steps, kept for the page's sections below the map
 * (ADR-1091 D1 (3), (4)): the claims and the harness come from these when their increments place them.
 */

/** A pain overcome, with its fix: the owner's words, final (ADR-0889 2.4). */
export type Fix = { pain: string; fix: string };
/** Another company's published mark, shown unaltered beside its name as a plain "works with" reference. */
export type Mark = { name: string; src: string };

export const fixes = {
  title: "What storytree fixes",
  pairs: [
    { pain: "No idea what your agents built", fix: "See your whole project as a map" },
    { pain: "Agents colliding in a void of code", fix: "Agents see each other working on the map" },
    { pain: "Agents forgetting why it was built that way", fix: "Every decision remembered, anchored to the map" },
  ] satisfies Fix[],
  why: "Storytree answers to four principles. Signals must be real: everything you see comes from the real code and the real work, and says where it came from. Show what matters now and hide the rest: nothing asks for your attention unless it needs it. Your attention goes where you send it: you choose what to look into, and how deep to go. Nothing is out of reach: whatever storytree hides, you can always bring back.",
};

// The harnesses storytree watches and its setup check verifies (each its maker's own published mark: evidence/map-harness/ and
// evidence/harness-pi/ READMEs). Another harness is one more entry here, once storytree watches it; one that only speaks MCP
// is covered by the line beneath the marks (ADR-1007 D5, as ADR-1018 D11 words it).
export const harness = {
  title: "Works with your harness.",
  // The owner's line (2026-10-13).
  claim: "Storytree works with your existing coding harness.",
  how: "Storytree doesn't replace the agent you code with. When you set up a project it looks for Claude Code and Codex, and joins their sessions through hooks and an MCP server: the hooks tell storytree what each session reads and changes, and the MCP server gives the agent storytree's tools for the plan and the library. Any other harness that speaks MCP can connect to the server too: it gets the plan, claims and the library, though storytree doesn't watch its session.",
  why: "You keep the agents, prompts and habits you already have; storytree adds the map beside them.",
  marks: [{ name: "Claude Code", src: "/harness/claude-code.png" }, { name: "Codex", src: "/harness/codex.png" }, { name: "Pi", src: "/harness/pi.svg" }] satisfies Mark[],
  marksNote: "And any harness that speaks MCP.",
};
