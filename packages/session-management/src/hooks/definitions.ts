// Capability 3 · Hooks
import { holdsName, normalisedWords } from "@storytree/library/whole-words";
import { freshIds, notYetGivenIds } from "./given-once.js";

export interface InjectionReport {
  readonly title: string;
  readonly description: string;
  readonly statement: string;
  readonly evidence: string;
  readonly impact: string;
}

export interface Definition {
  readonly id: string;
  readonly term: string;
  readonly meaning: string;
}

export interface NamedDefinition extends Definition {
  readonly name: string;
}

const MEANING_CHARS = 200;
const SHORTEST_NAME = 3;
const NOTICE_HEAD = 400;
export const BIG_INJECTION_BYTES = 8 * 1024;
const BIG_INJECTION_TITLE = "One prompt's definitions passed 8 KB";
const TERMS_A_NAME = 3;
const NOTICE_MARKERS = ["[SYSTEM NOTIFICATION - NOT USER INPUT]", "<task-notification>", "<system-reminder>", "<agent-message", "[Subagent hand-back]"];

export function isHarnessNotice(prompt: string): boolean {
  const head = prompt.slice(0, NOTICE_HEAD);
  return NOTICE_MARKERS.some((marker) => head.includes(marker));
}

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

export function definitionsContext(definitions: readonly Definition[]): string {
  return [
    "[storytree] Definitions from this project's library for terms in this prompt (open an artifact by its id to read all of it):",
    ...definitions.map((definition) => `- ${definition.term} (${definition.id}): ${firstLine(definition.meaning)}`),
  ].join("\n");
}

export function notYetGiven<D extends Definition>(session: string, definitions: readonly D[]): D[] {
  const fresh = new Set(freshIds(session, definitions.map(({ id }) => id), "definitions"));
  return definitions.filter(({ id }) => fresh.has(id));
}

export function bigInjectionReport(session: string, added: readonly NamedDefinition[], context: string): InjectionReport | undefined {
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

function tally(groups: Iterable<string>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) for (const name of group) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

function firstLine(meaning: string): string {
  const line = meaning.split(/\r?\n/, 1)[0]!.trim();
  return line.length > MEANING_CHARS ? `${line.slice(0, MEANING_CHARS - 1)}…` : line;
}
