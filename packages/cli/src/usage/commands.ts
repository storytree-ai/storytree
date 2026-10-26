/**
 * Capability 14 · Reading the doors' use. The command line's own usage reading (ADR-1071 D3; the counts of ADR-0983
 * D2, read as ADR-0998 D1 set): one window of the command door's `door-answered` lines counted against the commands
 * walked from this door's table. A pure count: the lines and the declared commands are handed in.
 *
 * - Use per command: every declared command with its calls and sessions, those with none at zero, each with its
 *   consumers (ADR-1045 D1); one a person may call is not judged, since a person's own terminal writes no line. A verb
 *   the table does not declare (the bare `storytree`, a family a word was refused in) is listed apart, never dropped.
 * - Misses: each word refused as unknown, where it was refused and the command the refusal named, and the unknowns
 *   per 1,000 calls.
 * - Failures by class, and refusals (a "no" by design) apart from them.
 */
import type { Consumer } from "@storytree/library/verbs";

/** One of the command door's `door-answered` lines, as the reading needs it. */
export interface CommandLine {
  readonly session: string;
  /** The command as the door names it: `storytree arc show`. */
  readonly verb: string;
  readonly outcome: "answered" | "unknown" | "refused" | "failed" | "denied-by-arm";
  readonly word?: string;
  readonly named?: string;
  readonly class?: string;
}

/** One declared command, with the consumers its story declared for it. */
export interface DeclaredCommand {
  readonly verb: string;
  readonly consumers: readonly Consumer[];
}

/** One command's use; `judged` is false when a person may call it. */
export interface CommandSurface { readonly door: "command"; readonly verb: string; readonly declared: boolean; readonly consumers?: readonly Consumer[]; readonly judged: boolean; readonly calls: number; readonly sessions: number }
export interface CommandMiss { readonly door: "command"; readonly where: string; readonly word: string; readonly named?: string; readonly count: number }
export interface CommandFailure { readonly door: "command"; readonly verb: string; readonly class: string; readonly count: number }
export interface CommandRefusal { readonly door: "command"; readonly verb: string; readonly count: number }

/** One window's use of the commands. */
export interface CommandUse {
  readonly calls: number;
  /** Declared commands first, most used first; then verbs the table does not declare. */
  readonly surfaces: readonly CommandSurface[];
  readonly misses: readonly CommandMiss[];
  /** Unknowns per 1,000 calls; null with no call. */
  readonly unknownPer1000: number | null;
  readonly failures: readonly CommandFailure[];
  readonly refusals: readonly CommandRefusal[];
}

/** Count `lines`, the window's command-door lines, against the `declared` commands. */
export function readCommandUse(lines: readonly CommandLine[], declared: readonly DeclaredCommand[]): CommandUse {
  const unknown = lines.filter((line) => line.outcome === "unknown");
  return {
    calls: lines.length,
    surfaces: surfaces(lines, declared),
    misses: tally(unknown, (line) => [line.verb, line.word ?? "", line.named ?? ""] as const)
      .map(([[where, word, named], count]) => ({ door: "command", where, word, ...(named === "" ? {} : { named }), count })),
    unknownPer1000: lines.length === 0 ? null : Math.round((10000 * unknown.length) / lines.length) / 10,
    failures: tally(lines.filter((line) => line.outcome === "failed"), (line) => [line.verb, line.class ?? "unnamed"] as const)
      .map(([[verb, kind], count]) => ({ door: "command", verb, class: kind, count })),
    refusals: tally(lines.filter((line) => line.outcome === "refused"), (line) => [line.verb] as const)
      .map(([[verb], count]) => ({ door: "command", verb, count })),
  };
}

function surfaces(lines: readonly CommandLine[], declared: readonly DeclaredCommand[]): CommandSurface[] {
  const seen = new Map<string, { calls: number; sessions: Set<string> }>();
  for (const line of lines) {
    const use = seen.get(line.verb) ?? { calls: 0, sessions: new Set<string>() };
    use.calls += 1;
    use.sessions.add(line.session);
    seen.set(line.verb, use);
  }
  const byUse = (a: CommandSurface, b: CommandSurface) => b.calls - a.calls || a.verb.localeCompare(b.verb);
  const known = [...new Map(declared.map(({ verb, consumers }) => [verb, {
    door: "command", verb, declared: true, consumers, judged: !consumers.includes("user"), calls: seen.get(verb)?.calls ?? 0, sessions: seen.get(verb)?.sessions.size ?? 0,
  } as const])).values()];
  const names = new Set(declared.map(({ verb }) => verb));
  const others = [...seen].filter(([verb]) => !names.has(verb))
    .map(([verb, use]) => ({ door: "command", verb, declared: false, judged: true, calls: use.calls, sessions: use.sessions.size } as const));
  return [...known.sort(byUse), ...others.sort(byUse)];
}

/** How many of `items` share each key, most first, then in the order first seen. */
function tally<T, K extends readonly string[]>(items: readonly T[], keyOf: (item: T) => K): [K, number][] {
  const counts = new Map<string, [K, number]>();
  for (const item of items) {
    const key = keyOf(item);
    const id = JSON.stringify(key);
    counts.set(id, [key, (counts.get(id)?.[1] ?? 0) + 1]);
  }
  return [...counts.values()].sort((a, b) => b[1] - a[1]);
}
