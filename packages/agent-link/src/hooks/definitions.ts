/**
 * Definition lookups at each prompt (ADR-0636 D1, b2; 0.2's `definition-injection.mjs`, ported by
 * behaviour): when the user sends a prompt, the hook adds the project library's definitions for the
 * terms it names, so the agent reads the project's meaning of a word before it acts on it.
 *
 * - A definition answers to its term, and to each `/`-separated part of it. A name shorter than
 *   three letters is never looked for.
 * - A name is found as whole words, ignoring case, with `-`, `_` and runs of spaces read as one
 *   space, and its last word may be plural (`claims` finds "Claim", `policies` finds "Policy").
 * - At most five are added, the longest name first (a tie keeps the library's order), and each only
 *   once a session: the ones already given are left out after choosing, so a prompt of known terms
 *   does not pull in weaker ones.
 * - A harness's own notice, sent to the agent as if it were a prompt, gets none: 0.2's markers, in
 *   the first 400 characters.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A definition, as the library holds it. */
export interface Definition {
  readonly id: string;
  readonly term: string;
  readonly meaning: string;
}

/** The most definitions one prompt adds. */
export const MAX_DEFINITIONS = 5;
/** How much of a meaning is shown: its first line, cut to this many characters. */
const MEANING_CHARS = 200;
/** The shortest name looked for. */
const SHORTEST_NAME = 3;
/** How far into a prompt a harness's notice marker is looked for. */
const NOTICE_HEAD = 400;
/** What a harness puts at the head of its own notices to the agent. */
const NOTICE_MARKERS = ["[SYSTEM NOTIFICATION - NOT USER INPUT]", "<task-notification>", "<system-reminder>"];

/** Whether `prompt` is a harness's own notice rather than something a person wrote. */
export function isHarnessNotice(prompt: string): boolean {
  const head = prompt.slice(0, NOTICE_HEAD);
  return NOTICE_MARKERS.some((marker) => head.includes(marker));
}

/** The definitions `prompt` names, at most MAX_DEFINITIONS, longest name first. */
export function definitionsNamedIn(prompt: string, definitions: readonly Definition[]): Definition[] {
  const text = normalised(prompt);
  const found: { definition: Definition; length: number; order: number }[] = [];
  definitions.forEach((definition, order) => {
    const names = [definition.term, ...definition.term.split("/")].map(normalised).filter((name) => name.length >= SHORTEST_NAME);
    const length = Math.max(0, ...names.filter((name) => pattern(name).test(text)).map((name) => name.length));
    if (length > 0) found.push({ definition, length, order });
  });
  return found
    .sort((a, b) => b.length - a.length || a.order - b.order)
    .slice(0, MAX_DEFINITIONS)
    .map(({ definition }) => definition);
}

/** What the agent is shown for `definitions`. */
export function definitionsContext(definitions: readonly Definition[]): string {
  return [
    "[storytree] Definitions from this project's library for terms in this prompt (open an artifact by its id to read all of it):",
    ...definitions.map((definition) => `- ${definition.term} (${definition.id}): ${firstLine(definition.meaning)}`),
  ].join("\n");
}

/**
 * The ones of `definitions` not yet given to `session`, which are then remembered as given. What a
 * session has been given is kept in the temporary folder, one file a session; a session id that
 * could not be a file name keeps nothing, so every definition is new to it.
 */
export function notYetGiven(session: string, definitions: readonly Definition[]): Definition[] {
  if (!/^[A-Za-z0-9._-]+$/.test(session)) return [...definitions];
  const folder = path.join(tmpdir(), "storytree-definitions");
  const file = path.join(folder, `${session}.json`);
  const given = new Set<string>(readGiven(file));
  const fresh = definitions.filter((definition) => !given.has(definition.id));
  if (fresh.length > 0) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, JSON.stringify([...given, ...fresh.map((definition) => definition.id)]));
  }
  return fresh;
}

function readGiven(file: string): string[] {
  try {
    const ids: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Lower case, with `-`, `_` and every run of spaces read as one space. */
function normalised(text: string): string {
  return text.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

/** `name` as whole words, its last word plural or not. */
function pattern(name: string): RegExp {
  const words = name.split(" ").map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const last = words.pop()!;
  const plural = last.endsWith("y") ? `(?:${last}|${last.slice(0, -1)}ies)` : `${last}(?:e?s)?`;
  return new RegExp(`(?<![\\p{L}\\p{N}])${[...words, plural].join(" ")}(?![\\p{L}\\p{N}])`, "u");
}

function firstLine(meaning: string): string {
  const line = meaning.split(/\r?\n/, 1)[0]!.trim();
  return line.length > MEANING_CHARS ? `${line.slice(0, MEANING_CHARS - 1)}…` : line;
}
