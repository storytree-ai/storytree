/** The forest owns its sessions surface; the desktop only mounts it and carries public reads. */
import React, { Fragment, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ContextReading, SessionWindow } from "@storytree/agent-link";
import type { Line } from "@storytree/agent-link/readings";
import { liveReading, pageKept, type LiveReads } from "@storytree/arc-surface";
import type { AnnotatedTree, ArcView } from "@storytree/library";
import type { RosterEntry } from "@storytree/knowledge-core";
import { atWork, sessionRoster, sessionRows, windowFiles, type SessionDetails, type SessionFiles, type SessionRow } from "../sessions-list/sessions-list.js";
import { sessionColour, sessionWisps, type SessionWisp } from "../agent-claims/agent-claims.js";

export interface SessionsReads extends LiveReads {
  projectTree(project: string): Promise<AnnotatedTree>;
  arcView(project: string, id: string): Promise<ArcView | null>;
  /** The agent link's context readings (9.5, 9.8) for these sessions, read now; the rows' bars and totals. */
  contextReadings?(project: string, sessions: readonly string[]): Promise<readonly ContextReading[]>;
  /** A session's window (agent link 9.10), read when its row is expanded: the files its expansion lists. */
  windowReading?(project: string, session: string): Promise<SessionWindow>;
  /** The user's idle-after setting in milliseconds; without it the list judges idleness by the 30-minute default. */
  idleAfterMs?(): Promise<number>;
  /** The user's leave-after setting in milliseconds; without it a quiet session leaves the list by the 1-hour default. */
  leaveAfterMs?(): Promise<number>;
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
    && Array.isArray(row.stories) && Array.isArray(row.worktrees) && Array.isArray(row.running) && row.worktrees.every(tree => typeof tree?.path === "string") && Array.isArray(row.description) && isSessionRows(row.children));
}

function everyId(rows: readonly SessionRow[]): string[] {
  return rows.flatMap(row => [row.id, ...everyId(row.children)]);
}

/** Whether the strip shows its rows, kept per project in the page's storage like the arcs bar's state; nothing kept, or a foreign value, is expanded (7.17). */
export function keptPanelOpen(project: string, storage?: Parameters<typeof pageKept>[2]) {
  const kept = pageKept<boolean>(`storytree.forest.sessions-open.v1:${project}`, (value): value is boolean => typeof value === "boolean", storage);
  return { read: (): boolean => kept.read() ?? true, write: (open: boolean): void => kept.write(open) };
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
  let leaveMs: number | undefined;
  let askedAt = -Infinity;
  let asking = false;
  let highlighted: string | undefined;
  let selected: string | undefined;
  // Every row starts expanded; these are the ones the user folded.
  let collapsed: ReadonlySet<string> = new Set();
  const openKept = keptPanelOpen(options.project);
  let stripOpen = openKept.read();
  const pending = new Set<string>();
  let files: ReadonlyMap<string, SessionFiles> = new Map();
  let stopped = false;
  const draw = (error?: string): void => root.render(<SessionsList rows={rows} loading={tree === undefined && rows.length === 0}
    refreshing={tree === undefined && rows.length > 0}
    error={error} highlighted={highlighted} selected={selected} onHighlight={options.onHighlight}
    collapsed={collapsed} files={files} onToggle={toggle} open={stripOpen}
    onToggleOpen={() => { stripOpen = !stripOpen; openKept.write(stripOpen); draw(); }}
    {...(options.onSelect ? { onSelect: options.onSelect } : {})} />);
  /** Supplied details (showDetails) keep their parent; a reading supplies the tokens and groups. */
  const merged = (): ReadonlyMap<string, SessionDetails> => new Map([...new Set([...details.keys(), ...readings.keys()])]
    .map(id => [id, { ...details.get(id), ...readings.get(id) }]));
  /** Read an expanded row's files, one read at a time; a failed read says so and the next ask tries again. */
  const askFiles = (session: string): void => {
    const read = options.reads.windowReading;
    if (read === undefined || pending.has(session)) return;
    pending.add(session);
    read.call(options.reads, options.project, session).then(window => windowFiles(window),
      () => ({ absent: "the window could not be read" })).then(answer => {
      pending.delete(session);
      if (stopped || collapsed.has(session)) return;
      files = new Map([...files, [session, answer]]);
      draw();
    });
  };
  const toggle = (session: string): void => {
    const next = new Set(collapsed);
    if (next.delete(session)) askFiles(session);
    else { next.add(session); files = new Map([...files].filter(([id]) => id !== session)); }
    collapsed = next;
    draw();
  };
  const askReadings = (): void => {
    const ask = options.reads.contextReadings;
    if (ask === undefined || asking || Date.now() - askedAt < READING_EVERY_MS || rows.length === 0) return;
    asking = true;
    askedAt = Date.now();
    for (const session of everyId(rows)) if (!collapsed.has(session)) askFiles(session);
    options.reads.idleAfterMs?.().then(ms => { quietMs = ms; }, () => {
      // An unreadable setting keeps the last one read; the next ask tries again.
    });
    options.reads.leaveAfterMs?.().then(ms => { leaveMs = ms; }, () => {
      // As idle-after: the last one read stands until the next ask.
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
    rows = sessionRows(tree, lines, arcs, now, merged(), quietMs, leaveMs);
    kept.write(rows);
    for (const session of everyId(rows)) if (!collapsed.has(session) && !files.has(session)) askFiles(session);
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

function toggle(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** A worktree's folder name, the trunk's too, from its full path on any platform. */
const folderName = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** How long a command has run, in its largest two units: 12s, 1m, 1h 5m. */
export function ranFor(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : minutes % 60 === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** An expanded row's detail (7.8): its description's lines (7.14), then each worktree by its folder's name (full path on hover), then the files in its window, each block labelled. */
function SessionDetail({ row, files }: { row: SessionRow; files: SessionFiles | undefined }) {
  return <div className="session-detail">
    {row.description.length > 0 && <div className="session-description">{row.description.map(said => <p key={said}>{said}</p>)}</div>}
    {row.worktrees.length > 0 && <section className="session-detail-block">
      <p className="session-detail-label">Worktrees</p>
      <ul className="session-detail-worktrees" aria-label="Worktrees">
        {row.worktrees.map(tree => <li key={tree.path} title={[tree.path, ...tree.branches].join("\n")}>{folderName(tree.path)}
          {tree.state !== undefined && <span className="session-worktree-state" data-state={tree.state}>{tree.label ?? tree.state}</span>}</li>)}</ul></section>}
    {row.running.length > 0 && <section className="session-detail-block">
      <p className="session-detail-label">Running</p>
      <ul className="session-detail-running" aria-label="Running">
        {row.running.map((run, index) => <li key={index} title={run.command.slice(0, 300)}><span className="session-run-command">{run.words}</span>
          <span className="session-run-time">{ranFor(run.ranMs)}</span></li>)}</ul></section>}
    <section className="session-detail-block">
    <p className="session-detail-label">Files</p>
    {files === undefined ? <p className="session-detail-note">Reading files…</p>
      : "absent" in files ? <p className="session-detail-note">No files: {files.absent}</p>
      : files.files.length === 0 ? <p className="session-detail-note">No files opened</p>
      : <ul className="session-detail-files" aria-label="Files in its window">
        {files.files.map(file => <li key={file.path} data-resident={file.resident ? undefined : "no"}
          title={file.resident ? file.path : `${file.path}\nNo longer in its window`}>{file.path}</li>)}</ul>}
    </section>
  </div>;
}

/** The one row the quiet sessions fold into (ADR-0758 D5): "N idle", opening to list them. None when there are none. */
function IdleFold({ count, open, onToggle }: { count: number; open: boolean; onToggle(): void }) {
  if (count === 0) return null;
  return <li><button type="button" className="session-idle-fold" aria-expanded={open}
    aria-label={`${open ? "Hide" : "Show"} ${count} idle session${count === 1 ? "" : "s"}`} onClick={onToggle}>{count} idle</button></li>;
}

export function SessionsList({ rows, loading = false, refreshing = false, error, highlighted, selected, onHighlight, onSelect, files, ...control }: {
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
  /** The rows folded, when the caller keeps them; otherwise the list keeps its own. Every other row is expanded (7.17). */
  collapsed?: ReadonlySet<string>;
  onToggle?(session: string): void;
  /** Each expanded row's files, once read (7.8). */
  files?: ReadonlyMap<string, SessionFiles>;
  /** Whether the strip shows its rows (7.17), when the caller keeps it; otherwise the list keeps its own, starting expanded. */
  open?: boolean;
  onToggleOpen?(): void;
}) {
  const [own, setOwn] = useState<ReadonlySet<string>>(new Set());
  const [ownOpen, setOwnOpen] = useState(true);
  const stripOpen = control.open ?? ownOpen;
  const onToggleOpen = control.onToggleOpen ?? (() => setOwnOpen(!ownOpen));
  const collapsed = control.collapsed ?? own;
  const isOpen = (id: string): boolean => !collapsed.has(id);
  const onToggle = control.onToggle ?? ((id: string) => setOwn(toggle(own, id)));
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [idleOpen, setIdleOpen] = useState(false);
  const visible: { row: SessionRow; depth: number }[] = [];
  /** Each row's top-level session: a click on a child selects its parent, whose reads it shares. */
  const rootOf = new Map<string, string>();
  const visit = (list: readonly SessionRow[], depth: number, top?: string): void => {
    for (const row of list) {
      visible.push({ row, depth });
      rootOf.set(row.id, top ?? row.id);
      if (isOpen(row.id)) visit(row.children, depth + 1, top ?? row.id);
    }
  };
  // Sessions at work first; the quiet ones fold into one "N idle" row, shown under it when opened (ADR-0758 D5).
  const idle = rows.filter(row => row.idle);
  visit(rows.filter(row => !row.idle), 0);
  const atWorkCount = visible.length;
  if (idleOpen) visit(idle, 0);
  // Folded, the strip draws no rows, so none is hovered or drawn.
  if (!stripOpen) visible.length = 0;
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
  return <aside className="sessions-list" data-fresh={refreshing ? "no" : undefined} data-open={stripOpen} aria-label="Running sessions">
    {/* The header toggles the whole list, like the arcs bar's (7.17): a click anywhere on it, the button for the keyboard. */}
    <header onClick={onToggleOpen}>
      <button type="button" className="sessions-handle" aria-expanded={stripOpen} aria-controls="sessions-body"
        aria-label={stripOpen ? "Hide sessions" : "Show sessions"} title={stripOpen ? "Hide sessions" : "Show sessions"}>
        Sessions <span className="sessions-count" title="Sessions at work or waiting for you">{atWork(rows)}</span></button>
      <span className="session-legend" aria-label="Bar colours">
        {GROUPS.map(([group, name]) => <span key={group} data-group={group}><span className="session-swatch" aria-hidden="true" />{name}</span>)}
      </span>
      <span className="sessions-caret" aria-hidden="true">{stripOpen ? "▾" : "▴"}</span>
    </header>
    <div id="sessions-body" className="sessions-body" hidden={!stripOpen}>
    {loading && !error && <p role="status">Reading sessions…</p>}
    {refreshing && !error && <p role="status">As last read. Refreshing…</p>}
    {error && <p role="status">{error}</p>}
    {!loading && rows.length === 0 && <p>No running sessions</p>}
    <ul>
      {visible.map(({ row, depth }, index) => <Fragment key={row.id}>
      {index === atWorkCount && <IdleFold count={idle.length} open={idleOpen} onToggle={() => setIdleOpen(!idleOpen)} />}
      <li style={{ marginLeft: Math.min(depth, 5) * 14 }}>
        <div className="session-row" data-session-id={row.id} data-state={row.state} data-idle={row.idle || undefined} data-highlighted={row.id === highlighted || undefined}
          data-selected={row.id === selected || undefined} tabIndex={0}
          onClick={() => { const top = rootOf.get(row.id)!; onSelect?.(top === selected ? undefined : top); }}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault(); const top = rootOf.get(row.id)!; onSelect?.(top === selected ? undefined : top); } }}
          aria-label={`${row.label} · ${row.agent}${row.machine === undefined ? "" : ` on ${row.machine}`}`}
          onPointerEnter={() => setHovered(row.id)} onPointerLeave={() => setHovered(undefined)}
          onFocus={() => setFocused(row.id)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(undefined); }}>
          {/* One expander per row, at its start (7.8): its detail and its children (7.2), counted by the "+N" after its name. */}
          <button type="button" className="session-children-toggle" aria-expanded={isOpen(row.id)}
            aria-label={`${isOpen(row.id) ? "Hide" : "Show"} detail${row.children.length > 0 ? ` and ${row.children.length} children` : ""} of ${row.label}`}
            onClick={event => { event.stopPropagation(); onToggle(row.id); }} />
          {depth === 0 && <span className="session-colour" style={{ background: sessionColour(row.id) }} aria-hidden="true" />}
          <span className="session-label" title={`${row.label}\n${row.agent} · ${row.id}${row.machine === undefined ? "" : ` · on ${row.machine}`}${row.state === "observed" ? "\nSubagent observed; current state unavailable" : ""}${row.worktrees.length > 0 ? `\n${row.worktrees.map(tree => tree.path).join("\n")}` : ""}`}>{row.label}</span>
          {row.machine !== undefined && <span className="session-machine" title={`Runs on ${row.machine}`}>{row.machine}</span>}
          {row.children.length > 0 && <span className="session-children" aria-hidden="true">+{row.children.length}</span>}
          {row.worktrees.length > 1 && <span className="session-worktrees" title={row.worktrees.map(tree => tree.path).join("\n")}
            aria-label={`works in ${row.worktrees.length} worktrees`}>{row.worktrees.length} worktrees</span>}
          <ContextBar row={row} />
          <span className="session-total" title={row.totalTokens === undefined ? "Context total unavailable" : `${row.totalTokens.toLocaleString("en-US")} context tokens`}>
            {row.totalTokens === undefined ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(row.totalTokens)}</span>
        </div>
        {isOpen(row.id) && <SessionDetail row={row} files={files?.get(row.id)} />}
      </li></Fragment>)}
      {stripOpen && atWorkCount === visible.length && <IdleFold count={idle.length} open={idleOpen} onToggle={() => setIdleOpen(!idleOpen)} />}
    </ul>
    </div>
  </aside>;
}
