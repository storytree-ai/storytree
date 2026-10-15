/**
 * Capability 3 · Hooks. Definition lookups at each prompt (ADR-0636 D1, b2; 0.2's `definition-injection.mjs`, ported by
 * behaviour): when the user sends a prompt, the hook adds the project library's definitions for the
 * terms it names, so the agent reads the project's meaning of a word before it acts on it.
 *
 * - A definition answers to its term, and to each `/`-separated part of it, but only by a name
 *   that points at it alone: its term unless another definition has the same term, and a part only
 *   when no other definition answers to it. So "Review/Ledger" and "Review/Brief" answer to their
 *   own parts but not to "Review", which they share, and two definitions of one term answer to
 *   neither it nor its parts (0.2 split on `/` too, but its 52 definitions shared no part). A name
 *   shorter than three letters is never looked for.
 * - A name is found as whole words, ignoring case, with `-`, `_` and runs of spaces read as one
 *   space, and its last word may be plural (`claims` finds "Claim", `policies` finds "Policy"): the
 *   library's whole-words rule, which ranked search's title lift shares (ADR-1044 D3).
 * - Every match is added, the longest name first (a tie keeps the library's order), and each only
 *   once a session: the ones already given are left out.
 * - A harness's own notice, sent to the agent as if it were a prompt, gets none: 0.2's markers, and
 *   an agent's message (a subagent's report, another session's message), in the first 400 characters.
 * - Nothing is cut (ADR-1049 D1): one prompt's definitions past BIG_INJECTION_BYTES are all added, and
 *   the first such prompt of a session also files a friction report, naming what each came through,
 *   for the drain to take to the owner (D2).
 */
import { holdsName, normalisedWords } from "@storytree/library/whole-words";
import type { NewFriction } from "../capture/index.js";
import { notYetGivenIds } from "./given-once.js";

/** A definition, as the library holds it. */
export interface Definition {
  readonly id: string;
  readonly term: string;
  readonly meaning: string;
}

/** A definition a prompt named, with the name it answered to. */
export interface NamedDefinition extends Definition {
  readonly name: string;
}

/** How much of a meaning is shown: its first line, cut to this many characters. */
const MEANING_CHARS = 200;
/** The shortest name looked for. */
const SHORTEST_NAME = 3;
/** How far into a prompt a harness's notice marker is looked for. */
const NOTICE_HEAD = 400;
/** How big one prompt's added definitions may be before a friction report is filed (ADR-1049 D2): a reporting threshold, never a cap. */
export const BIG_INJECTION_BYTES = 8 * 1024;
/** The title of that report. */
const BIG_INJECTION_TITLE = "One prompt's definitions passed 8 KB";
/** How many terms the report shows for each name they came through. */
const TERMS_A_NAME = 3;
/**
 * What a harness puts at the head of its own notices to the agent: 0.2's three, and the wrapping of
 * an agent's message (a subagent's report handed back, or another session's message).
 */
const NOTICE_MARKERS = ["[SYSTEM NOTIFICATION - NOT USER INPUT]", "<task-notification>", "<system-reminder>", "<agent-message", "[Subagent hand-back]"];

/** Whether `prompt` is a harness's own notice rather than something a person wrote. */
export function isHarnessNotice(prompt: string): boolean {
  const head = prompt.slice(0, NOTICE_HEAD);
  return NOTICE_MARKERS.some((marker) => head.includes(marker));
}

/** All definitions `prompt` names, longest name first. */
export function definitionsNamedIn(prompt: string, definitions: readonly Definition[]): NamedDefinition[] {
  const termsAndParts = definitions.map(({ term }) => {
    const whole = normalisedWords(term);
    return { whole, parts: new Set(term.split("/").map(normalisedWords).filter((part) => part !== whole)) };
  });
  const termHolders = tally(termsAndParts.map(({ whole }) => [whole]));
  const nameHolders = tally(termsAndParts.map(({ whole, parts }) => new Set([whole, ...parts])));
  const found: { definition: Definition; name: string; order: number }[] = [];
  definitions.forEach((definition, order) => {
    const { whole, parts } = termsAndParts[order]!;
    const names = [
      ...(termHolders.get(whole) === 1 ? [whole] : []),
      ...[...parts].filter((part) => nameHolders.get(part) === 1),
    ].filter((name) => name.length >= SHORTEST_NAME);
    const [name] = names.filter((name) => holdsName(prompt, name)).sort((a, b) => b.length - a.length);
    if (name !== undefined) found.push({ definition, name, order });
  });
  return found
    .sort((a, b) => b.name.length - a.name.length || a.order - b.order)
    .map(({ definition, name }) => ({ ...definition, name }));
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
export function notYetGiven<D extends Definition>(session: string, definitions: readonly D[]): D[] {
  const fresh = new Set(notYetGivenIds(session, definitions.map(({ id }) => id), "definitions"));
  return definitions.filter(({ id }) => fresh.has(id));
}

/**
 * The friction report for `added`, the definitions one prompt of `session` added as `context`, when
 * the context passes BIG_INJECTION_BYTES and is the session's first to: its evidence groups the
 * definitions by the name each came through, since one name bringing in many is the sprawl it is
 * for. At most one a session, remembered as soon as it is decided, whether or not its filing succeeds.
 */
export function bigInjectionReport(session: string, added: readonly NamedDefinition[], context: string): NewFriction | undefined {
  const bytes = Buffer.byteLength(context);
  if (bytes <= BIG_INJECTION_BYTES || notYetGivenIds(session, [BIG_INJECTION_TITLE], "big-injections").length === 0) return undefined;
  const byName = new Map<string, string[]>();
  for (const { name, term } of added) byName.set(name, [...(byName.get(name) ?? []), term]);
  const names = [...byName].sort((a, b) => b[1].length - a[1].length).map(([name, terms]) => {
    const shown = terms.slice(0, TERMS_A_NAME).map((term) => `"${term}"`).join(", ");
    return `- "${name}" brought ${terms.length}: ${shown}${terms.length > TERMS_A_NAME ? ", …" : ""}`;
  });
  return {
    title: BIG_INJECTION_TITLE,
    description: `The per-prompt definitions hook added ${added.length} definitions, ${bytes} bytes, to one prompt of session ${session}.`,
    statement: `One prompt's definitions passed ${BIG_INJECTION_BYTES} bytes. All were added (ADR-1049 D1: no cap); a name that brings in many may be definition sprawl.`,
    evidence: [`Session ${session}: ${added.length} definitions, ${bytes} bytes. The names they came through, most first:`, ...names].join("\n"),
    impact: `${bytes} bytes of the agent's context went to one prompt's definitions.`,
  };
}

/** How many of `groups` hold each name. */
function tally(groups: Iterable<string>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) for (const name of group) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

function firstLine(meaning: string): string {
  const line = meaning.split(/\r?\n/, 1)[0]!.trim();
  return line.length > MEANING_CHARS ? `${line.slice(0, MEANING_CHARS - 1)}…` : line;
}
