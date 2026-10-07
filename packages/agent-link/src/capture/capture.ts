/**
 * Capability 6 · Agent tools (the MCP server). Friction and re-steer capture, with storytree 0.2's evidence rules (ADR-0643 D1, the owner's n4;
 * 0.2's `packages/cli/src/friction.ts` and `resteer.ts`). These are this story's functions: the
 * agent tools call them, and a person's command line (`0-3-cli-story-tree`) calls the same ones.
 * They write through the library's `writeKnowledge`, which keeps the rules of the records
 * themselves (a friction's evidence, a defect's failure mode: the library's 6.7); what is added here
 * is only the capture's own floor.
 *
 * - Evidence must be concrete (0.2's ADR-0168 D3): a path, a pull request or issue number, a
 *   commit, a command and its output, an error, or a quoted excerpt. Vague prose is refused. The
 *   check is deliberately dumb about truth: it only refuses what cannot be a citation.
 * - A re-steer's evidence is the user's (the owner's) own words inside double quotation marks: a paraphrase is the agent's account,
 *   which goes in `selfReport`, apart (0.2's ADR-0513 D4). "Judged by the owner" is the owner's call, never
 *   an inference of the agent's.
 * - Capture never classifies: friction is filed without a route, which is decided later by someone
 *   other than the session that filed it (0.2's ADR-0168 D4).
 */
import type { Library, NewKnowledge, SchemaRecord, WriteOptions } from "@storytree/library";

/** A capture refused before anything is written: its message says what to fix. */
export class CaptureError extends Error {}

/** Friction as it is filed: what went wrong, the evidence for it, and what it cost. */
export interface NewFriction {
  readonly title: string;
  readonly description: string;
  readonly statement: string;
  readonly evidence: string;
  readonly impact: string;
  readonly links?: string[];
  /** The calling folder's branch; callers outside a repository share the no-branch bucket. */
  readonly branch?: string;
}

/** What happened this time, on the branch that encountered it. Its date is stamped at capture. */
export interface Reinforcement {
  readonly branch: string;
  readonly evidence: string;
}

/** A re-steer as it is filed: what the agent was doing, what the owner redirected it to, and the owner's words. */
export interface NewResteer {
  readonly title: string;
  readonly description: string;
  readonly doing: string;
  readonly redirect: string;
  /** The owner's own words, quoted. */
  readonly evidence: string;
  /** The agent's own account of it, kept apart from the owner's words. */
  readonly selfReport?: string;
  readonly disposition: "defect" | "taste";
  /** Who judged it a defect or taste: the owner, or the agent. */
  readonly dispositionBy: "owner" | "agent";
  /** Its failure mode, needed for a defect ("no-mast-home" when none describes it). */
  readonly mode?: string;
  readonly links?: string[];
}

/** 0.2's floor for concrete evidence (ADR-0168 D3), with its repository paths made any project's. */
const CONCRETE_EVIDENCE: readonly RegExp[] = [
  /`[^`]+`/, // a code, command or output span
  /\b[\w-]+\.(ts|tsx|js|mjs|cjs|json|md|sql|sh|yml|yaml|css|html|py|txt|toml|mts|cts)\b/, // a file with a known extension
  /\b[\w.-]+\/[\w./-]+/, // a path
  /#\d+/, // a pull request or issue number
  /\b[0-9a-f]{7,40}\b/, // a commit
  /\b(Error|Exception|Traceback|TS\d{2,}|ERR_[A-Z][A-Z_]+|exit code|non-zero|refused|assert(?:ion)?|FAIL(?:ED)?|throws?)\b/, // an error
  /["'“][^"'”]{3,}["'”]/, // a quoted excerpt
  /\b(pnpm|npm|npx|node|git|storytree|tsx|gh|python|pip|cargo|go)\s+[\w-]/, // a command
];

/** True when `text` carries at least one concrete citation. */
export function hasConcreteEvidence(text: string): boolean {
  return CONCRETE_EVIDENCE.some((pattern) => pattern.test(text));
}

/** A quoted excerpt: the only evidence a re-steer takes. */
const QUOTED = /["“][^"”]{3,}["”]/;

/**
 * File friction with concrete evidence, at most three times per writer, branch and UTC day
 * (ADR-0716, narrowed to the writer): every session of a user's project may share one branch, so a
 * branch-wide count let the day's first session use up the others' reports. One whose writer was not
 * recorded counts toward every writer's three.
 */
export async function recordFriction(library: Library, friction: NewFriction, options?: WriteOptions): Promise<SchemaRecord<"friction">> {
  requireConcreteEvidence(friction.evidence);
  const { branch = "(no branch)", ...fields } = friction;
  const date = new Date().toISOString().slice(0, 10);
  const today = (await library.list("friction")).filter(({ fields }) =>
    fields.provenance?.branch === branch && fields.provenance.date === date,
  );
  let filed = 0;
  for (const { id } of today) {
    const writer = (await library.history({ id }))[0]?.actor;
    if (writer === undefined || writer === options?.actor) filed++;
  }
  if (filed >= 3) {
    throw new CaptureError(`Filing cap: 3 friction items already filed on "${branch}" for ${date} by this session (ADR-0716; ADR-0168 D3). Distil to the three that fought you hardest, or use storytree friction reinforce <id> --evidence ... for a recurrence.`);
  }
  return library.writeKnowledge("friction", { ...fields, provenance: { branch, date, source: "retro" } }, options);
}

/** Append a recurrence to one existing friction, never changing its route or minting a twin. */
export async function reinforceFriction(library: Library, id: string, recurrence: Reinforcement, options?: WriteOptions): Promise<SchemaRecord<"friction">> {
  requireConcreteEvidence(recurrence.evidence);
  const friction = await library.get(id);
  if (friction?.type !== "friction") throw new CaptureError(`No live friction item ${id} to reinforce.`);
  const saved = await library.editNote(id, { reinforcedBy: [
    ...(friction.fields.reinforcedBy ?? []),
    { branch: recurrence.branch, date: new Date().toISOString().slice(0, 10), evidence: recurrence.evidence },
  ] }, options);
  if (saved?.type !== "friction") throw new CaptureError(`Friction item ${id} is no longer there to reinforce.`);
  return saved;
}

function requireConcreteEvidence(evidence: string): void {
  if (!hasConcreteEvidence(evidence)) {
    throw new CaptureError(
      `friction's evidence must be concrete: a path, a pull request, a commit, a command and its output, an error, or a quoted excerpt. Vague prose is refused. You gave: ${evidence}`,
    );
  }
}

/** File a re-steer, if its evidence quotes the owner. */
export async function recordResteer(library: Library, resteer: NewResteer, options?: WriteOptions): Promise<SchemaRecord<"resteer">> {
  if (!QUOTED.test(resteer.evidence)) {
    // The check is only for quotation marks, so the refusal names them: the exact words alone, unmarked, do not pass.
    throw new CaptureError(
      `a re-steer's evidence is the user's own words inside double quotation marks: put what they said between them, as in "Can you add it now?". A paraphrase is your account of those words, which goes in the self-report. You gave: ${resteer.evidence}`,
    );
  }
  // Its failure mode is checked against the library's own list of modes, inside the write.
  return library.writeKnowledge("resteer", { ...resteer } as NewKnowledge<"resteer">, options);
}
