// Capability 14 · Reading the doors' use
import { judgedByLines, type Consumer } from "@storytree/library/verbs";

export interface CommandLine {
  readonly session: string;
  readonly verb: string;
  readonly outcome: "answered" | "unknown" | "refused" | "failed" | "denied-by-arm";
  readonly word?: string;
  readonly named?: string;
  readonly class?: string;
}

export interface DeclaredCommand {
  readonly verb: string;
  readonly consumers: readonly Consumer[];
}

export interface CommandSurface { readonly door: "command"; readonly verb: string; readonly declared: boolean; readonly consumers?: readonly Consumer[]; readonly judged: boolean; readonly calls: number; readonly sessions: number }
export interface CommandMiss { readonly door: "command"; readonly where: string; readonly word: string; readonly named?: string; readonly count: number }
export interface CommandFailure { readonly door: "command"; readonly verb: string; readonly class: string; readonly count: number }
export interface CommandRefusal { readonly door: "command"; readonly verb: string; readonly count: number }

export interface CommandUse {
  readonly calls: number;
  readonly surfaces: readonly CommandSurface[];
  readonly misses: readonly CommandMiss[];
  readonly unknownPer1000: number | null;
  readonly failures: readonly CommandFailure[];
  readonly refusals: readonly CommandRefusal[];
}

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
    door: "command", verb, declared: true, consumers, judged: judgedByLines(consumers), calls: seen.get(verb)?.calls ?? 0, sessions: seen.get(verb)?.sessions.size ?? 0,
  } as const])).values()];
  const names = new Set(declared.map(({ verb }) => verb));
  const others = [...seen].filter(([verb]) => !names.has(verb))
    .map(([verb, use]) => ({ door: "command", verb, declared: false, judged: true, calls: use.calls, sessions: use.sessions.size } as const));
  return [...known.sort(byUse), ...others.sort(byUse)];
}

function tally<T, K extends readonly string[]>(items: readonly T[], keyOf: (item: T) => K): [K, number][] {
  const counts = new Map<string, [K, number]>();
  for (const item of items) {
    const key = keyOf(item);
    const id = JSON.stringify(key);
    counts.set(id, [key, (counts.get(id)?.[1] ?? 0) + 1]);
  }
  return [...counts.values()].sort((a, b) => b[1] - a[1]);
}
