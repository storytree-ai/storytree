/** The forest owns its sessions surface; the desktop only mounts it and carries public reads. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Line } from "@storytree/agent-link/readings";
import { liveReading, type LiveReads } from "@storytree/arc-surface";
import type { AnnotatedTree, ArcView } from "@storytree/library";
import { sessionRows, type SessionDetails, type SessionRow } from "../sessions-list/sessions-list.js";
import { sessionColour, sessionWisps, type SessionWisp } from "../agent-claims/agent-claims.js";

export interface SessionsReads extends LiveReads {
  projectTree(project: string): Promise<AnnotatedTree>;
  arcView(project: string, id: string): Promise<ArcView | null>;
}

/** The optional details seam takes already-read facts; it never asks for or parses transcripts. */
export function mountSessionsList(container: HTMLElement, options: {
  project: string;
  reads: SessionsReads;
  onHighlight(stories: readonly string[] | undefined, session?: string): void;
  /** Hears each listed session's wisps (capability 5) whenever the rows are redrawn. */
  onWisps?(wisps: readonly SessionWisp[]): void;
}) {
  const host = document.createElement("div");
  container.append(host);
  const root = createRoot(host);
  let tree: AnnotatedTree | undefined;
  let arcs: ArcView[] = [];
  let lines: Line[] = [];
  let rows: SessionRow[] = [];
  let details: ReadonlyMap<string, SessionDetails> = new Map();
  let highlighted: string | undefined;
  let stopped = false;
  const draw = (error?: string): void => root.render(<SessionsList rows={rows} loading={tree === undefined}
    error={error} highlighted={highlighted} onHighlight={options.onHighlight} />);
  const refresh = (now: Date): void => {
    if (stopped || tree === undefined) return;
    rows = sessionRows(tree, lines, arcs, now, details);
    options.onWisps?.(sessionWisps(rows, lines, now));
    draw();
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
    stop() {
      stopped = true;
      reading.stop();
      options.onHighlight(undefined);
      root.unmount();
      host.remove();
    },
  };
}

export function SessionsList({ rows, loading = false, error, highlighted, onHighlight }: {
  rows: readonly SessionRow[];
  loading?: boolean;
  error?: string | undefined;
  /** The session whose wisp is hovered on the forest. */
  highlighted?: string | undefined;
  onHighlight(stories: readonly string[] | undefined, session?: string): void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [filesOpen, setFilesOpen] = useState<ReadonlySet<string>>(new Set());
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const visible: { row: SessionRow; depth: number }[] = [];
  const visit = (list: readonly SessionRow[], depth: number): void => {
    for (const row of list) {
      visible.push({ row, depth });
      if (expanded.has(row.id)) visit(row.children, depth + 1);
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
      sessions: visible.map(({ row }) => row.id), unclaimed: visible.reduce((n, { row }) => n + row.offPlan.length, 0) });
  });
  const toggle = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };
  return <aside className="sessions-list" aria-label="Running sessions">
    <header>Sessions <span>{rows.length}</span></header>
    {loading && !error && <p role="status">Reading sessions…</p>}
    {error && <p role="status">{error}</p>}
    {!loading && rows.length === 0 && <p>No running sessions</p>}
    <ul>
      {visible.map(({ row, depth }) => <li key={row.id} style={{ marginLeft: Math.min(depth, 5) * 14 }}>
        <div className="session-row" data-session-id={row.id} data-state={row.state} data-highlighted={row.id === highlighted || undefined} tabIndex={0}
          aria-label={`${row.label} · ${row.agent}${row.needsYou ? " · needs you" : ""}`}
          onPointerEnter={() => setHovered(row.id)} onPointerLeave={() => setHovered(undefined)}
          onFocus={() => setFocused(row.id)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(undefined); }}>
          {depth === 0 && <span className="session-colour" style={{ background: sessionColour(row.id) }} aria-hidden="true" />}
          <span className="session-label" title={`${row.label}\n${row.agent} · ${row.id}${row.state === "observed" ? "\nSubagent observed; current state unavailable" : ""}`}>{row.label}</span>
          {row.children.length > 0 && <button type="button" className="session-children-toggle" aria-expanded={expanded.has(row.id)}
            aria-label={`${expanded.has(row.id) ? "Hide" : "Show"} ${row.children.length} children of ${row.label}`}
            onClick={() => setExpanded(toggle(expanded, row.id))}>+{row.children.length}</button>}
          {row.needsYou && <span className="session-needs-you">needs you</span>}
          {row.offPlan.length > 0 && <button type="button" className="session-off-plan" aria-expanded={filesOpen.has(row.id)}
            aria-label={`${filesOpen.has(row.id) ? "Hide" : "Show"} off-plan work for ${row.label}`}
            onClick={() => setFilesOpen(toggle(filesOpen, row.id))}>off plan · {row.files.length} {row.files.length === 1 ? "file" : "files"}</button>}
          <span className="session-context-slot" aria-hidden="true" />
          <span className="session-total" title={row.totalTokens === undefined ? "Context total unavailable" : `${row.totalTokens.toLocaleString("en-US")} context tokens`}>
            {row.totalTokens === undefined ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(row.totalTokens)}</span>
        </div>
        {filesOpen.has(row.id) && <div className="session-evidence">
          <p>Edits and commands made outside a claim.</p>
          <ol>{row.offPlan.map((entry, index) => <li key={index}>
            <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
            {entry.command === undefined ? entry.files.map(file => <code key={file}>{file}</code>) : <code>{entry.command}</code>}
          </li>)}</ol>
        </div>}
      </li>)}
    </ul>
  </aside>;
}
