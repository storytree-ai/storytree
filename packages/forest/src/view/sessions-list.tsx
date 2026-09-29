/** The forest owns its sessions surface; the desktop only mounts it and carries public reads. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ContextReading } from "@storytree/agent-link";
import type { Line } from "@storytree/agent-link/readings";
import { liveReading, pageKept, type LiveReads } from "@storytree/arc-surface";
import type { AnnotatedTree, ArcView } from "@storytree/library";
import type { RosterEntry } from "@storytree/knowledge-core";
import { sessionRoster, sessionRows, type SessionDetails, type SessionRow } from "../sessions-list/sessions-list.js";
import { sessionColour, sessionWisps, type SessionWisp } from "../agent-claims/agent-claims.js";

export interface SessionsReads extends LiveReads {
  projectTree(project: string): Promise<AnnotatedTree>;
  arcView(project: string, id: string): Promise<ArcView | null>;
  /** The agent link's context readings (9.5, 9.8) for these sessions, read now; the rows' bars and totals. */
  contextReadings?(project: string, sessions: readonly string[]): Promise<readonly ContextReading[]>;
  /** The user's idle-after setting in milliseconds; without it the list judges idleness by the 30-minute default. */
  idleAfterMs?(): Promise<number>;
}

/** How often the listed sessions' context readings are asked for again. */
const READING_EVERY_MS = 10_000;

/** A reading as the facts a row shows: its tokens, and its four groups when it has them. */
function detailsOf(reading: ContextReading): SessionDetails {
  if (!("tokens" in reading)) return {};
  const guidance = "absent" in reading.guidance ? {} : { guidance: reading.guidance.value };
  return "absent" in reading.composition ? { totalTokens: reading.tokens, ...guidance }
    : { totalTokens: reading.tokens, ...guidance, composition: { injected: reading.composition.injected, grounding: reading.composition.grounding,
      implementation: reading.composition.implementation, other: reading.composition.other } };
}

/** Whether a kept value is session rows, so rows kept by an older build are not drawn. */
export function isSessionRows(value: unknown): value is SessionRow[] {
  return Array.isArray(value) && value.every((row: Partial<SessionRow> | null) => typeof row === "object" && row !== null
    && typeof row.id === "string" && typeof row.label === "string" && typeof row.agent === "string" && typeof row.state === "string"
    && Array.isArray(row.stories) && Array.isArray(row.worktrees) && isSessionRows(row.children));
}

function everyId(rows: readonly SessionRow[]): string[] {
  return rows.flatMap(row => [row.id, ...everyId(row.children)]);
}

/** The optional details seam takes already-read facts; it never asks for or parses transcripts. */
export function mountSessionsList(container: HTMLElement, options: {
  project: string;
  reads: SessionsReads;
  onHighlight(stories: readonly string[] | undefined, session?: string): void;
  /** Hears each listed session's wisps (capability 5) whenever the rows are redrawn. */
  onWisps?(wisps: readonly SessionWisp[]): void;
  /** Hears the listed rows as the knowledge core's roster whenever they are redrawn (ADR-0738 D2). */
  onRoster?(roster: readonly RosterEntry[]): void;
  /** A row was clicked: select its session, or undefined to go back to every session (ADR-0738 D5). */
  onSelect?(session: string | undefined): void;
}) {
  const host = document.createElement("div");
  container.append(host);
  const root = createRoot(host);
  let tree: AnnotatedTree | undefined;
  let arcs: ArcView[] = [];
  let lines: Line[] = [];
  // The rows last drawn for this project, shown marked as refreshing until the first read lands.
  const kept = pageKept(`storytree.forest.sessions.v1:${options.project}`, isSessionRows);
  let rows: SessionRow[] = kept.read() ?? [];
  let details: ReadonlyMap<string, SessionDetails> = new Map();
  let readings: ReadonlyMap<string, SessionDetails> = new Map();
  let quietMs: number | undefined;
  let askedAt = -Infinity;
  let asking = false;
  let highlighted: string | undefined;
  let selected: string | undefined;
  let stopped = false;
  const draw = (error?: string): void => root.render(<SessionsList rows={rows} loading={tree === undefined && rows.length === 0}
    refreshing={tree === undefined && rows.length > 0}
    error={error} highlighted={highlighted} selected={selected} onHighlight={options.onHighlight}
    {...(options.onSelect ? { onSelect: options.onSelect } : {})} />);
  /** Supplied details (showDetails) keep their parent; a reading supplies the tokens and groups. */
  const merged = (): ReadonlyMap<string, SessionDetails> => new Map([...new Set([...details.keys(), ...readings.keys()])]
    .map(id => [id, { ...details.get(id), ...readings.get(id) }]));
  const askReadings = (): void => {
    const ask = options.reads.contextReadings;
    if (ask === undefined || asking || Date.now() - askedAt < READING_EVERY_MS || rows.length === 0) return;
    asking = true;
    askedAt = Date.now();
    options.reads.idleAfterMs?.().then(ms => { quietMs = ms; }, () => {
      // An unreadable setting keeps the last one read; the next ask tries again.
    });
    ask.call(options.reads, options.project, everyId(rows)).then(answers => {
      readings = new Map(answers.map(reading => [reading.session, detailsOf(reading)]));
    }, () => {
      // A reading that fails leaves the bars as they were; the next ask tries again.
    }).finally(() => {
      asking = false;
      if (!stopped) refresh(new Date(), false);
    });
  };
  const refresh = (now: Date, ask = true): void => {
    if (stopped || tree === undefined) return;
    rows = sessionRows(tree, lines, arcs, now, merged(), quietMs);
    kept.write(rows);
    options.onWisps?.(sessionWisps(rows, lines, now, quietMs));
    options.onRoster?.(sessionRoster(rows));
    draw();
    if (ask) askReadings();
  };
  draw();
  const reading = liveReading({ project: options.project, reads: options.reads,
    async onNews(news) {
      let nextTree = tree;
      let nextArcs = arcs;
      if (tree === undefined || news.changes.length > 0) {
        nextTree = await options.reads.projectTree(options.project);
        const views = await Promise.all(nextTree.arcs.map(({ id }) => options.reads.arcView(options.project, id)));
        nextArcs = views.filter((arc): arc is ArcView => arc !== null);
      }
      if (stopped) return;
      tree = nextTree;
      arcs = nextArcs;
      lines = [...lines, ...news.lines];
      refresh(new Date());
    },
    onClock(now) { refresh(new Date(now)); },
    onError() { if (!stopped) draw("Sessions could not be refreshed. Retrying…"); },
  });
  return {
    showDetails(next: ReadonlyMap<string, SessionDetails>) { details = next; refresh(new Date()); },
    /** Highlight a session's row from its wisp, or none. */
    hover(session: string | undefined) { highlighted = session; draw(); },
    /** Mark the session the knowledge core has selected, or none. */
    select(session: string | undefined) { selected = session; draw(); },
    stop() {
      stopped = true;
      reading.stop();
      options.onHighlight(undefined);
      root.unmount();
      host.remove();
    },
  };
}

/**
 * The bar's scale: 1,000,000 tokens across its full width, the same for every row so rows compare.
 * A reading carries no window size (ADR-0728 D1), so this is the display's choice, not a limit; a
 * session past it fills the bar and its total says how far.
 */
export const BAR_TOKENS = 1_000_000;
const GROUPS = [["injected", "Injected"], ["grounding", "Grounding"], ["implementation", "Implementation"], ["other", "Other"]] as const;

const percent = (tokens: number): string => `${+(Math.min(tokens, BAR_TOKENS) / BAR_TOKENS * 100).toFixed(2)}%`;
const count = (tokens: number): string => Math.round(tokens).toLocaleString("en-US");

/** A row's context: its tokens on the bar's scale, split into the reading's four groups when it has them. */
function ContextBar({ row }: { row: SessionRow }) {
  const tokens = row.totalTokens;
  if (tokens === undefined) return <span className="session-context-slot" aria-hidden="true" />;
  const { composition } = row;
  const sum = composition === undefined ? 0 : GROUPS.reduce((total, [group]) => total + composition[group], 0);
  const parts = composition === undefined || sum === 0 ? undefined
    : GROUPS.map(([group, name]) => ({ group, name, tokens: tokens * composition[group] / sum }));
  const title = parts === undefined ? `${count(tokens)} tokens`
    : `${count(tokens)} tokens: ${parts.map(part => `${part.name} ${count(part.tokens)}`).join(" · ")} (an estimated split)`;
  return <span className="session-context-slot" title={title}>
    {parts === undefined
      ? <span className="session-segment" data-group="raw" style={{ width: percent(tokens) }} />
      : parts.map(part => <span key={part.group} className="session-segment" data-group={part.group} style={{ width: percent(part.tokens) }} />)}
    {/* One mark, at the user's context guidance past which a Claude Code session is nudged (ADR-0739 D1); Codex has no nudge (D5), so no mark. */}
    {row.agent === "Claude Code" && row.guidance !== undefined && <span className="session-tick" style={{ left: percent(row.guidance) }} />}
  </span>;
}

export function SessionsList({ rows, loading = false, refreshing = false, error, highlighted, selected, onHighlight, onSelect }: {
  rows: readonly SessionRow[];
  loading?: boolean;
  /** The rows are the ones last kept, drawn before this start's first read lands. */
  refreshing?: boolean;
  error?: string | undefined;
  /** The session whose wisp is hovered on the forest. */
  highlighted?: string | undefined;
  /** The session the knowledge core has selected. */
  selected?: string | undefined;
  onHighlight(stories: readonly string[] | undefined, session?: string): void;
  onSelect?(session: string | undefined): void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const visible: { row: SessionRow; depth: number }[] = [];
  /** Each row's top-level session: a click on a child selects its parent, whose reads it shares. */
  const rootOf = new Map<string, string>();
  const visit = (list: readonly SessionRow[], depth: number, top?: string): void => {
    for (const row of list) {
      visible.push({ row, depth });
      rootOf.set(row.id, top ?? row.id);
      if (expanded.has(row.id)) visit(row.children, depth + 1, top ?? row.id);
    }
  };
  visit(rows, 0);
  const active = visible.find(({ row }) => row.id === (hovered ?? focused ?? highlighted))?.row;
  const islands = active?.stories.join("\0");
  const session = active?.id;
  useEffect(() => {
    onHighlight(islands ? islands.split("\0") : undefined, session);
    return () => onHighlight(undefined);
  }, [islands, session, onHighlight]);
  useEffect(() => {
    document.body.dataset.drew = JSON.stringify({ ...JSON.parse(document.body.dataset.drew ?? "{}"),
      sessions: visible.map(({ row }) => row.id) });
  });
  const toggle = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };
  return <aside className="sessions-list" data-fresh={refreshing ? "no" : undefined} aria-label="Running sessions">
    <header>
      <span>Sessions <span className="sessions-count">{rows.length}</span></span>
      <span className="session-legend" aria-label="Bar colours">
        {GROUPS.map(([group, name]) => <span key={group} data-group={group}><span className="session-swatch" aria-hidden="true" />{name}</span>)}
      </span>
    </header>
    {loading && !error && <p role="status">Reading sessions…</p>}
    {refreshing && !error && <p role="status">As last read. Refreshing…</p>}
    {error && <p role="status">{error}</p>}
    {!loading && rows.length === 0 && <p>No running sessions</p>}
    <ul>
      {visible.map(({ row, depth }) => <li key={row.id} style={{ marginLeft: Math.min(depth, 5) * 14 }}>
        <div className="session-row" data-session-id={row.id} data-state={row.state} data-highlighted={row.id === highlighted || undefined}
          data-selected={row.id === selected || undefined} tabIndex={0}
          onClick={() => { const top = rootOf.get(row.id)!; onSelect?.(top === selected ? undefined : top); }}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault(); const top = rootOf.get(row.id)!; onSelect?.(top === selected ? undefined : top); } }}
          aria-label={`${row.label} · ${row.agent}${row.needsYou ? " · needs you" : ""}`}
          onPointerEnter={() => setHovered(row.id)} onPointerLeave={() => setHovered(undefined)}
          onFocus={() => setFocused(row.id)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(undefined); }}>
          {depth === 0 && <span className="session-colour" style={{ background: sessionColour(row.id) }} aria-hidden="true" />}
          <span className="session-label" title={`${row.label}\n${row.agent} · ${row.id}${row.state === "observed" ? "\nSubagent observed; current state unavailable" : ""}${row.worktrees.length > 0 ? `\n${row.worktrees.join("\n")}` : ""}`}>{row.label}</span>
          {row.worktrees.length > 1 && <span className="session-worktrees" title={row.worktrees.join("\n")}
            aria-label={`works in ${row.worktrees.length} worktrees`}>{row.worktrees.length} worktrees</span>}
          {row.children.length > 0 && <button type="button" className="session-children-toggle" aria-expanded={expanded.has(row.id)}
            aria-label={`${expanded.has(row.id) ? "Hide" : "Show"} ${row.children.length} children of ${row.label}`}
            onClick={event => { event.stopPropagation(); setExpanded(toggle(expanded, row.id)); }}>+{row.children.length}</button>}
          {row.needsYou && <span className="session-needs-you">needs you</span>}
          <ContextBar row={row} />
          <span className="session-total" title={row.totalTokens === undefined ? "Context total unavailable" : `${row.totalTokens.toLocaleString("en-US")} context tokens`}>
            {row.totalTokens === undefined ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(row.totalTokens)}</span>
        </div>
      </li>)}
    </ul>
  </aside>;
}
