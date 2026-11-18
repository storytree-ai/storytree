// Capability 8 · Reading the tools' use
import { judgedByLines, type Consumer } from "@storytree/library/verbs";

export interface ToolLine {
  readonly session: string;
  readonly verb: string;
  readonly outcome: "answered" | "unknown" | "refused" | "failed" | "denied-by-arm";
  readonly word?: string;
  readonly named?: string;
  readonly class?: string;
}

export interface ServedTool {
  readonly verb: string;
  readonly consumers: readonly Consumer[];
}

export interface ToolSurface { readonly door: "tool"; readonly verb: string; readonly declared: boolean; readonly consumers?: readonly Consumer[]; readonly judged: boolean; readonly calls: number; readonly sessions: number }
export interface ToolMiss { readonly door: "tool"; readonly where: string; readonly word: string; readonly named?: string; readonly count: number }
export interface ToolFailure { readonly door: "tool"; readonly verb: string; readonly class: string; readonly count: number }
export interface ToolRefusal { readonly door: "tool"; readonly verb: string; readonly count: number }

export interface ToolUse {
  readonly calls: number;
  readonly surfaces: readonly ToolSurface[];
  readonly misses: readonly ToolMiss[];
  readonly unknownPer1000: number | null;
  readonly failures: readonly ToolFailure[];
  readonly refusals: readonly ToolRefusal[];
}

export function readToolUse(lines: readonly ToolLine[], served: readonly ServedTool[]): ToolUse {
  const unknown = lines.filter((line) => line.outcome === "unknown");
  return {
    calls: lines.length,
    surfaces: surfaces(lines, served),
    misses: tally(unknown, (line) => [line.verb, line.word ?? "", line.named ?? ""] as const)
      .map(([[where, word, named], count]) => ({ door: "tool", where, word, ...(named === "" ? {} : { named }), count })),
    unknownPer1000: lines.length === 0 ? null : Math.round((10000 * unknown.length) / lines.length) / 10,
    failures: tally(lines.filter((line) => line.outcome === "failed"), (line) => [line.verb, line.class ?? "unnamed"] as const)
      .map(([[verb, kind], count]) => ({ door: "tool", verb, class: kind, count })),
    refusals: tally(lines.filter((line) => line.outcome === "refused"), (line) => [line.verb] as const)
      .map(([[verb], count]) => ({ door: "tool", verb, count })),
  };
}

function surfaces(lines: readonly ToolLine[], served: readonly ServedTool[]): ToolSurface[] {
  const seen = new Map<string, { calls: number; sessions: Set<string> }>();
  for (const line of lines) {
    const use = seen.get(line.verb) ?? { calls: 0, sessions: new Set<string>() };
    use.calls += 1;
    use.sessions.add(line.session);
    seen.set(line.verb, use);
  }
  const byUse = (a: ToolSurface, b: ToolSurface) => b.calls - a.calls || a.verb.localeCompare(b.verb);
  const known = [...new Map(served.map(({ verb, consumers }) => [verb, {
    door: "tool", verb, declared: true, consumers, judged: judgedByLines(consumers), calls: seen.get(verb)?.calls ?? 0, sessions: seen.get(verb)?.sessions.size ?? 0,
  } as const])).values()];
  const names = new Set(served.map(({ verb }) => verb));
  const others = [...seen].filter(([verb]) => !names.has(verb))
    .map(([verb, use]) => ({ door: "tool", verb, declared: false, judged: true, calls: use.calls, sessions: use.sessions.size } as const));
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
