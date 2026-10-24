// Capability 3 · Story node render. What a committed evidence seed may hold: every script that dumps library records
// into a file in the repository passes them through sanitiseSeed, and the gate refuses a seed seedProblems finds.
// A seed keeps the plan's shape (stories, capabilities, contracts, health) and its knowledge; arcs keep their id,
// title and stories; work records (increments, questions, waits, friction, resteers) and withheld arcs never leave.

/** Arcs whose records stay in the library: the arc itself and every record that names it. */
export const WITHHELD_ARCS: readonly string[] = ["arc_bfbc3b617d69"];

/** Record kinds a seed keeps whole: the plan's shape, its health and the project's knowledge. */
const KEPT = new Set([
  "story", "capability", "contract", "health",
  "decision", "definition", "principle", "guardrail", "pattern", "process", "agent", "techstack", "check", "research", "experiment",
]);
/** Record kinds a seed must never hold. */
const WORK = new Set(["increment", "question", "wait", "friction", "resteer"]);

/** Each pattern a seed may not carry, with the placeholder that takes its place. */
const MACHINES = "MicksMSpro|mickh-a520i-ac|micksoldlaptop|winlap";
const REDACTIONS: readonly [string, RegExp, string][] = [
  ["a link to a claude.ai artifact, code session or share", /https?:\/\/(?:www\.)?claude\.ai\/(?:public\/)?(?:artifacts?|code|share)\b[^\s"'<>)\]]*/gi, "<claude-link>"],
  ["a Google Drive or Docs link", /https?:\/\/(?:drive|docs)\.google\.com\/[^\s"'<>)\]]*/gi, "<google-doc-link>"],
  // git@github.com is GitHub's own SSH address, not a person's.
  ["an email address", /(?<![A-Za-z0-9._%+-])(?!git@github\.com)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "<email>"],
  ["a user@host", new RegExp(`(?<![A-Za-z0-9._-])[A-Za-z0-9._-]+@(?:${MACHINES}|[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.ts\\.net)\\b`, "gi"), "<user@host>"],
  ["a Windows home folder", /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/\s"'<>]+/gi, "<home>"],
  ["a Linux home folder", /\/home\/[^/\s"'<>]+/g, "<home>"],
  ["a tailnet name", /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.ts\.net\b/gi, "<tailnet-host>"],
  ["a machine name", new RegExp(`\\b(?:${MACHINES})\\b`, "gi"), "<machine>"],
  ["a tailnet address", /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g, "<tailnet-address>"],
  ["the cloud project id", /\bstorytree-\d{6}\b/g, "<cloud-project>"],
];

/** The text with every pattern a seed may not carry replaced by its placeholder. */
export function redact(text: string): string {
  let out = text;
  for (const [, pattern, placeholder] of REDACTIONS) out = out.replace(pattern, placeholder);
  return out;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function deepRedact(value: Json): Json {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, deepRedact(inner)]));
  return value;
}

function names(value: unknown, ids: readonly string[]): boolean {
  if (ids.length === 0) return false;
  const text = JSON.stringify(value);
  return ids.some((id) => text.includes(id));
}

type Rec = { id?: string; type?: string; fields?: Record<string, unknown> } & Record<string, unknown>;

/** An arc record reduced to its title and stories; any other kept record as it is; anything else, nothing. */
function keepRecord(record: Rec): Rec | undefined {
  if (record.type === "arc") {
    const { title, stories } = record.fields ?? {};
    return { ...record, fields: { ...(title === undefined ? {} : { title }), ...(stories === undefined ? {} : { stories }) } };
  }
  return KEPT.has(record.type ?? "") ? record : undefined;
}

/**
 * A copy of a library dump (`tree`, `changes`, `covers` and the rest, the shape the forest's seeds share) that a
 * repository may hold: work records and withheld arcs dropped, arcs reduced to id, title and stories, every
 * redaction pattern replaced, ids kept. It reads only the dump, never the library.
 */
export function sanitiseSeed<T>(seed: T, withheld: readonly string[] = WITHHELD_ARCS): T {
  const out = structuredClone(seed) as Record<string, any>;
  const tree = out.tree;
  if (tree !== undefined) {
    if (Array.isArray(tree.arcs)) {
      tree.arcs = tree.arcs
        .filter((arc: Rec) => !withheld.includes(arc.id ?? "") && !names(arc, withheld))
        .map(({ id, title, stories }: Rec) => ({ id, title, stories }));
    }
    if (Array.isArray(tree.stories)) tree.stories = tree.stories.filter((story: Rec) => !names(story, withheld));
  }
  const changes = out.changes;
  const list: Rec[] | undefined = Array.isArray(changes) ? changes : Array.isArray(changes?.changes) ? changes.changes : undefined;
  if (list !== undefined) {
    const kept: Rec[] = [];
    for (const change of list) {
      if (!KEPT.has(String(change.type)) && change.type !== "arc") continue;
      if (withheld.includes(String(change.recordId)) || names(change, withheld)) continue;
      const record = change.record === undefined || change.record === null ? change.record : keepRecord(change.record as Rec);
      if (change.record != null && record === undefined) continue;
      kept.push(record === change.record ? change : { ...change, record });
    }
    if (Array.isArray(changes)) out.changes = kept;
    else changes.changes = kept;
  }
  if (out.covers !== undefined && out.covers !== null && typeof out.covers === "object") {
    const covers: Record<string, unknown> = {};
    for (const [node, shelf] of Object.entries(out.covers as Record<string, Rec[]>)) {
      if (names(node, withheld)) continue;
      const kept = (Array.isArray(shelf) ? shelf : []).filter((record) => !names(record, withheld)).map(keepRecord).filter((record) => record !== undefined);
      if (kept.length > 0) covers[node] = kept;
    }
    out.covers = covers;
  }
  if (Array.isArray(out.lines?.lines)) out.lines.lines = [];
  return deepRedact(out as Json) as T;
}

/**
 * Why a committed seed or snapshot may not be kept, one sentence each: a work record it holds, a withheld arc it
 * names, a redaction pattern it carries; empty when it is clean. `file` names the file in each sentence.
 */
export function seedProblems(file: string, text: string, withheld: readonly string[] = WITHHELD_ARCS): string[] {
  const problems: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const work = new Map<string, string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    const record = value as Rec;
    if (typeof record.type === "string" && WORK.has(record.type) && !work.has(record.type)) {
      work.set(record.type, String(record.id ?? record.recordId ?? "a record"));
    }
    Object.values(record).forEach(walk);
  };
  walk(parsed);
  for (const [kind, id] of work) problems.push(`${file} holds ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} record (${id}): pass the dump through sanitiseSeed`);
  for (const id of withheld) if (text.includes(id)) problems.push(`${file} names a withheld arc (${id}): pass the dump through sanitiseSeed`);
  for (const [what, pattern] of REDACTIONS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) problems.push(`${file} carries ${what}: pass the dump through sanitiseSeed`);
    pattern.lastIndex = 0;
  }
  return problems;
}
