// Capability 3 · Story node render

import { createHash } from "node:crypto";

export const WITHHELD_ARCS: readonly string[] = ["arc_bfbc3b617d69", "arc_824a506f2125"];

const KEPT = new Set([
  "story", "capability", "contract", "health",
  "decision", "definition", "principle", "guardrail", "pattern", "process", "agent", "techstack", "check", "research", "experiment",
]);
const WORK = new Set(["increment", "question", "wait", "friction", "resteer"]);

export interface Machine { hash: string; length: number; parts: number; role: string }

const digest = (text: string) => createHash("sha256").update(text.toLowerCase()).digest("hex");

export const MACHINES: readonly Machine[] = [
  { hash: "86f4579c353a17a9257c03830a9247e311ae7258963682105c744017e7d3f0f8", length: 14, parts: 3, role: "<mint-box>" },
  { hash: "0649151cd2c2ef0b8045beb8471c5fdc3a23cfb9ab6eefd5d872cfa41a6be2ff", length: 10, parts: 1, role: "<laptop>" },
  { hash: "c6a4c0ce842529ee649334b9c51649ff79d5510009be0a072611723bec241dc1", length: 14, parts: 1, role: "<test-laptop>" },
  { hash: "62bb5c4de13b56319bb9aea3f6d3cd545bdd90ad2ed4baffcfb5c6ac1429b6d8", length: 6, parts: 1, role: "<test-laptop>" },
];

export function machinesNamed(roles: Record<string, string>): Machine[] {
  return Object.entries(roles).map(([name, role]) => ({ hash: digest(name), length: name.length, parts: name.split("-").length, role }));
}

export function machineSpans(text: string, machines: readonly Machine[] = MACHINES): { index: number; name: string; role: string }[] {
  const spans: { index: number; name: string; role: string }[] = [];
  if (machines.length === 0) return spans;
  const byHash = new Map(machines.map((machine) => [machine.hash, machine]));
  const lengths = new Set(machines.map((machine) => machine.length));
  const most = Math.max(...machines.map((machine) => machine.parts));
  for (const run of text.matchAll(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g)) {
    const words = [...run[0].matchAll(/[A-Za-z0-9]+/g)];
    for (let first = 0; first < words.length; first++) {
      for (let last = Math.min(words.length, first + most) - 1; last >= first; last--) {
        const start = words[first]!.index!;
        const name = run[0].slice(start, words[last]!.index! + words[last]![0].length);
        const machine = lengths.has(name.length) ? byHash.get(digest(name)) : undefined;
        if (machine === undefined) continue;
        spans.push({ index: run.index! + start, name, role: machine.role });
        first = last;
        break;
      }
    }
  }
  return spans;
}

const AT_HOST = /(?<![A-Za-z0-9._-])[A-Za-z0-9._-]+@([A-Za-z0-9-]+)/g;
const atMachine = (host: string, machines: readonly Machine[]) => machineSpans(host, machines).some((span) => span.index === 0);

export const REDACTIONS: readonly [string, RegExp, string][] = [
  ["a link to a claude.ai artifact, code session or share", /https?:\/\/(?:www\.)?claude\.ai\/(?:public\/)?(?:artifacts?|code|share)\b[^\s"'<>)\]]*/gi, "<claude-link>"],
  ["a Google Drive or Docs link", /https?:\/\/(?:drive|docs)\.google\.com\/[^\s"'<>)\]]*/gi, "<google-doc-link>"],
  ["an email address", /(?<![A-Za-z0-9._%+-])(?!git@github\.com)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "<email>"],
  ["a user@host", /(?<![A-Za-z0-9._-])[A-Za-z0-9._-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.ts\.net\b/gi, "<user@host>"],
  ["a Windows home folder", /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/\s"'<>]+/gi, "<home>"],
  ["a Linux home folder", /\/home\/[^/\s"'<>]+/g, "<home>"],
  ["a tailnet name", /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.ts\.net\b/gi, "<tailnet-host>"],
  ["a tailnet address", /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g, "<tailnet-address>"],
  ["the cloud project id", /(?<![A-Za-z_-])storytree-\d{6}\b/g, "<cloud-project>"],
];

export function redactionsIn(text: string, machines: readonly Machine[] = MACHINES): [string, string][] {
  const found: [string, string][] = [];
  for (const [what, pattern] of REDACTIONS) for (const [match] of text.matchAll(pattern)) found.push([what, match]);
  for (const [match, host] of text.matchAll(AT_HOST)) if (atMachine(host!, machines)) found.push(["a user@host", match]);
  for (const { name } of machineSpans(text, machines)) found.push(["a machine name", name]);
  return found;
}

function redactionKinds(text: string, machines: readonly Machine[]): string[] {
  return [...new Set(redactionsIn(text, machines).map(([what]) => what))];
}

export function replaceMachines(text: string, machine: (name: string, role: string) => string, machines: readonly Machine[] = MACHINES): string {
  let out = text;
  for (const { index, name, role } of machineSpans(text, machines).reverse()) out = out.slice(0, index) + machine(name, role) + out.slice(index + name.length);
  return out;
}

export function redact(text: string, machine: (name: string, role: string) => string = () => "<machine>", machines: readonly Machine[] = MACHINES): string {
  let out = text;
  for (const [what, pattern, placeholder] of REDACTIONS) {
    out = out.replace(pattern, placeholder);
    if (what === "a user@host") out = out.replace(AT_HOST, (match, host: string) => (atMachine(host, machines) ? placeholder : match));
    if (what === "a tailnet name") out = replaceMachines(out, machine, machines);
  }
  return out;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function deepRedact(value: Json, scrub: (text: string) => string = redact): Json {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((inner) => deepRedact(inner, scrub));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, deepRedact(inner, scrub)]));
  return value;
}

const WRITERS = new Set(["scribedBy", "settledBy", "writer"]);
const SESSIONS = new Set(["by", "holder", "session", "takenOverFrom"]);
const ROLES = new Set(["owner", "agent"]);
const SESSION_ID = /(?:^(?:claude-code|codex|session) +[0-9a-f]{8})|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i;

function writerRole(who: unknown): string {
  if (typeof who === "string" && ROLES.has(who)) return who;
  return typeof who === "string" && /^(?:session|claude-code|codex)\b/.test(who) ? "agent" : "owner";
}

function byRole(value: Json): Json {
  if (Array.isArray(value)) return value.map(byRole);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key,
    WRITERS.has(key) ? writerRole(inner) : SESSIONS.has(key) && typeof inner === "string" && SESSION_ID.test(inner) ? "agent" : byRole(inner)]));
}

function names(value: unknown, ids: readonly string[]): boolean {
  if (ids.length === 0) return false;
  const text = JSON.stringify(value);
  return ids.some((id) => text.includes(id));
}

type Rec = { id?: string; type?: string; fields?: Record<string, unknown> } & Record<string, unknown>;

function keepRecord(record: Rec): Rec | undefined {
  if (record.type === "arc") {
    const { title, stories } = record.fields ?? {};
    return { ...record, fields: { ...(title === undefined ? {} : { title }), ...(stories === undefined ? {} : { stories }) } };
  }
  return KEPT.has(record.type ?? "") ? record : undefined;
}

export function sanitiseSeed<T>(seed: T, withheld: readonly string[] = WITHHELD_ARCS, machines: readonly Machine[] = MACHINES): T {
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
  return deepRedact(byRole(out as Json), (text) => redact(text, undefined, machines)) as T;
}

export function seedProblems(file: string, text: string, withheld: readonly string[] = WITHHELD_ARCS, machines: readonly Machine[] = MACHINES): string[] {
  const problems: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const work = new Map<string, string>();
  const writers = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    const record = value as Rec;
    if (typeof record.type === "string" && WORK.has(record.type) && !work.has(record.type)) {
      work.set(record.type, String(record.id ?? record.recordId ?? "a record"));
    }
    for (const [key, inner] of Object.entries(record)) {
      if (WRITERS.has(key) && !(typeof inner === "string" && ROLES.has(inner))) writers.add(`${file} names a writer other than by role in ${key}: say the writer's role (owner or agent)`);
      if (SESSIONS.has(key) && typeof inner === "string" && SESSION_ID.test(inner)) writers.add(`${file} names a session in ${key}: pass the dump through sanitiseSeed`);
    }
    Object.values(record).forEach(walk);
  };
  walk(parsed);
  for (const [kind, id] of work) problems.push(`${file} holds ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} record (${id}): pass the dump through sanitiseSeed`);
  problems.push(...writers);
  for (const id of withheld) if (text.includes(id)) problems.push(`${file} names a withheld arc (${id}): pass the dump through sanitiseSeed`);
  for (const what of redactionKinds(text, machines)) problems.push(`${file} carries ${what}: pass the dump through sanitiseSeed`);
  return problems;
}

const CONNECTOR_LINE = "a connector line from claude mcp list";

function namesConnector(line: string): boolean {
  const parts = line.split(":");
  return parts.some((part, at) => /\bclaude\.ai [^\n]/.test(part) && /^ https?$/.test(parts[at + 1] ?? "") && parts[at + 2]?.startsWith("//") === true);
}

const withoutConnectors = (text: string): string => text.split(/(?<=\n)/).filter((line) => !namesConnector(line)).join("");

const CAPTURE_REDACTIONS: readonly [string, RegExp, string][] = [
  ["a connector in a status line", /,?\bclaude\.ai [^=,\n"]+=[a-z]+/g, ""],
  ["a session id", /"session_id"\s*:\s*"[^"]*",?/g, ""],
  ["a synced plugin path", /(?<![^\s"'])[^\s"']*plugins(?:\\{1,2}|\/)synced(?:\\{1,2}|\/)[^\s"']*/gi, "<synced-plugin>"],
  ["a claude.ai link", /https?:\/\/(?:www\.)?claude\.ai\b[^\s"'<>)\]]*/gi, "<claude-link>"],
];

function scrubText(text: string, machines: readonly Machine[]): string {
  let out = withoutConnectors(text);
  for (const [, pattern, placeholder] of CAPTURE_REDACTIONS) out = out.replace(pattern, placeholder);
  return redact(out, (_name, role) => role, machines);
}

function scrubJson(value: Json): Json {
  if (Array.isArray(value)) return value.map(scrubJson);
  if (value === null || typeof value !== "object") return value;
  const out: { [key: string]: Json } = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === "session_id") continue;
    if (key === "mcp_servers" && Array.isArray(inner)) {
      out[key] = inner.filter((server) => !/^claude\.ai /.test(String((server as { name?: unknown } | null)?.name ?? ""))).map(scrubJson);
    } else out[key] = scrubJson(inner);
  }
  return out;
}

function scrubParsed(text: string, machines: readonly Machine[]): string | undefined {
  if (!/^\s*[[{]/.test(text)) return undefined;
  try {
    return JSON.stringify(deepRedact(scrubJson(JSON.parse(text) as Json), (inner) => scrubText(inner, machines)));
  } catch {
    return undefined;
  }
}

export function captureText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes);
}

export function scrubCapture(text: string, machines: readonly Machine[] = MACHINES): string {
  const whole = scrubParsed(text, machines);
  if (whole !== undefined) return whole + (text.endsWith("\n") ? "\n" : "");
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const scrubbed = scrubParsed(line, machines) ?? scrubText(line, machines);
    if (scrubbed.trim() !== "" || line.trim() === "") lines.push(scrubbed);
  }
  return lines.join("\n");
}

export function captureProblems(file: string, bytes: Uint8Array, machines: readonly Machine[] = MACHINES): string[] {
  const fix = "write it UTF-8 through scrubCapture (pnpm scrub:evidence <folder>)";
  const problems: string[] = [];
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || bytes.includes(0)) problems.push(`${file} is UTF-16, not UTF-8: ${fix}`);
  const text = captureText(bytes);
  if (text.split("\n").some(namesConnector)) problems.push(`${file} carries ${CONNECTOR_LINE}: ${fix}`);
  for (const [what, pattern] of CAPTURE_REDACTIONS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) problems.push(`${file} carries ${what}: ${fix}`);
    pattern.lastIndex = 0;
  }
  for (const what of redactionKinds(text, machines)) problems.push(`${file} carries ${what}: ${fix}`);
  return problems;
}
