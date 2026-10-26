/**
 * Capability 8 · Reading the tools' use. The MCP server's own usage reading (ADR-1071 D3; the counts of ADR-0983 D2,
 * read as ADR-0998 D1 set): one window of the tool door's `door-answered` lines counted against the tools it serves.
 * A pure count: the lines and the served tools are handed in, and nothing here reads the log or knows the other door.
 *
 * - Use per tool: every served tool with its calls and sessions, those with none at zero, each with its consumers
 *   (ADR-1045 D1); one a person may call is not judged, since a person's own calls write no line. A tool name the
 *   server does not serve is listed apart, never dropped.
 * - Misses: each name refused as unknown with what the refusal named, and the unknowns per 1,000 calls.
 * - Failures by class, and refusals (a "no" by design) apart from them.
 */
import type { Consumer } from "@storytree/library/verbs";

/** One of the tool door's `door-answered` lines, as the reading needs it. */
export interface ToolLine {
  readonly session: string;
  /** The tool as the server names it: `show_plan`. */
  readonly verb: string;
  readonly outcome: "answered" | "unknown" | "refused" | "failed" | "denied-by-arm";
  readonly word?: string;
  readonly named?: string;
  readonly class?: string;
}

/** One served tool, with the consumers its story declared for it. */
export interface ServedTool {
  readonly verb: string;
  readonly consumers: readonly Consumer[];
}

/** One tool's use; `judged` is false when a person may call it. */
export interface ToolSurface { readonly door: "tool"; readonly verb: string; readonly declared: boolean; readonly consumers?: readonly Consumer[]; readonly judged: boolean; readonly calls: number; readonly sessions: number }
export interface ToolMiss { readonly door: "tool"; readonly where: string; readonly word: string; readonly named?: string; readonly count: number }
export interface ToolFailure { readonly door: "tool"; readonly verb: string; readonly class: string; readonly count: number }
export interface ToolRefusal { readonly door: "tool"; readonly verb: string; readonly count: number }

/** One window's use of the tools. */
export interface ToolUse {
  readonly calls: number;
  /** Served tools first, most used first; then names the server does not serve. */
  readonly surfaces: readonly ToolSurface[];
  readonly misses: readonly ToolMiss[];
  /** Unknowns per 1,000 calls; null with no call. */
  readonly unknownPer1000: number | null;
  readonly failures: readonly ToolFailure[];
  readonly refusals: readonly ToolRefusal[];
}

/** Count `lines`, the window's tool-door lines, against the `served` tools. */
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
    door: "tool", verb, declared: true, consumers, judged: !consumers.includes("user"), calls: seen.get(verb)?.calls ?? 0, sessions: seen.get(verb)?.sessions.size ?? 0,
  } as const])).values()];
  const names = new Set(served.map(({ verb }) => verb));
  const others = [...seen].filter(([verb]) => !names.has(verb))
    .map(([verb, use]) => ({ door: "tool", verb, declared: false, judged: true, calls: use.calls, sessions: use.sessions.size } as const));
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
