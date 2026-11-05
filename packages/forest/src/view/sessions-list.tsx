/** Capability 7 · Running sessions. The forest owns its sessions surface; the desktop only mounts it and carries public reads. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AnnotatedTree, ArcView, Line } from "@storytree/library";
import { outageSaidOnce, saysUnreachable, type OutageSaidOnce } from "@storytree/library/connection-error";
import type { LogReading } from "@storytree/session-management/readings";
import { pageKept, pageReading, type LiveReads, type PageReading } from "@storytree/arc-surface";
import { clickedSelection, listedRows, openWork, sessionRoster, sessionRows, type RosterEntry, type SessionDetails, type SessionRow } from "../sessions-list/sessions-list.js";
import { sessionColour, sessionWisps, type SessionWisp } from "../agent-claims/agent-claims.js";
import { treeAfter } from "../render/forest-reading.js";

/** A session's context reading (Session management 9.5, 9.8), as a row shows it: the forest's own copy of what it reads (ADR-1017 D2). */
type ContextReading = { readonly session: string } & ({ readonly absent: string } | {
  readonly tokens: number;
  readonly composition: { readonly absent: string } | { readonly injected: number; readonly grounding: number; readonly implementation: number; readonly other: number };
  readonly guidance: { readonly absent: string } | { readonly value: number };
});

export interface SessionsReads extends LiveReads {
  projectTree(project: string): Promise<AnnotatedTree>;
  /** Every live arc's view in one ask (library 7.8): never one read per arc. */
  arcViews(project: string): Promise<readonly ArcView[]>;
  /** Session management's context readings (9.5, 9.8) for these sessions, read now; the rows' bars and totals. */
  contextReadings?(project: string, sessions: readonly string[]): Promise<readonly ContextReading[]>;
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

/** The record types an arc view is built from: a change to any other leaves the arcs as they were. */
const WORK_TYPES: ReadonlySet<string> = new Set(["arc", "increment", "question"]);

/**
 * The arcs the rows are built from after `news`: every arc in one ask, read again only when a change
 * touches an arc, an increment or a question, so other changes cost no arc read (ADR-0836 D3).
 */
export async function arcsAfter(reads: Pick<SessionsReads, "arcViews">, project: string,
  news: { readonly changes: readonly { readonly type: string }[] }, last: readonly ArcView[] | undefined): Promise<readonly ArcView[]> {
  if (last !== undefined && !news.changes.some(change => WORK_TYPES.has(change.type))) return last;
  return reads.arcViews(project);
}

/** The list's failed reads written to the console, so app.log: an unreachable library once per outage (8.11). */
export function sessionsOutage(): OutageSaidOnce {
  return outageSaidOnce((line, ...error) => console.error(`forest sessions list: ${line}`, ...error));
}

/**
 * Reads the list's idle-after and leave-after settings and `sessions`' context readings, each heard as it lands;
 * settles once all three have. A read that fails is told to `outage`, and what was read last stands until the next ask.
 */
export function readContext(reads: Pick<SessionsReads, "idleAfterMs" | "leaveAfterMs" | "contextReadings">, project: string, sessions: readonly string[],
  heard: { idleAfterMs(ms: number): void; leaveAfterMs(ms: number): void; readings(answers: readonly ContextReading[]): void },
  outage: OutageSaidOnce = sessionsOutage()): Promise<void> {
  const failed = (what: string) => (error: unknown): void => { outage.failed(`${what} could not be read`, error); };
  const answered = <T,>(hear: (answer: T) => void) => (answer: T): void => { outage.answered(); hear(answer); };
  return Promise.all([
    reads.idleAfterMs?.().then(answered(ms => heard.idleAfterMs(ms)), failed("the idle-after setting")),
    reads.leaveAfterMs?.().then(answered(ms => heard.leaveAfterMs(ms)), failed("the leave-after setting")),
    reads.contextReadings?.(project, sessions).then(answered(answers => heard.readings(answers)), failed("the context readings")),
  ]).then(() => {});
}

/** How long a failed refresh counts toward the banner, and how many in that time raise it (7.33). */
export const FAILURES_WINDOW_MS = 30_000;
export const FAILURES_SHOWN = 3;

/** What failed when no step of the list's own is named: the page reading's ask of the library, or its resume. */
export const NEWS_STEP = "reading the library's news";

/** A failure in one named step of the list's handling of news, carrying the error it caught. */
export class StepFailed extends Error {
  constructor(readonly step: string, override readonly cause: unknown) {
    super(`${step} failed`, { cause });
  }
}

/** Run `step`, naming it on any failure, so the banner and the app log say which read or step failed. */
async function named<T>(step: string, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new StepFailed(step, error);
  }
}

const said = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * The list's failed refreshes, kept so the banner says what failed and shows only once failures
 * persist (7.33): one the next ask recovers is no banner (decision_bf2b01d46359, the rows last drawn
 * stay meanwhile). The banner shows while `shown` failures fall within the last `windowMs`, and clears
 * once news is handled again or they age out. Each failure is told to `log` the first time its step
 * and message are heard since the last recovery, with its stack, so an outage writes one line, not one per ask.
 */
export function refreshFailures(log: (line: string) => void, windowMs = FAILURES_WINDOW_MS, shown = FAILURES_SHOWN) {
  let failures: { step: string; message: string; at: number }[] = [];
  const logged = new Set<string>();
  return {
    failed(error: unknown, at: number): void {
      const step = error instanceof StepFailed ? error.step : NEWS_STEP;
      const cause = error instanceof StepFailed ? error.cause : error;
      const message = said(cause);
      failures = [...failures.filter(failure => at - failure.at < windowMs), { step, message, at }];
      if (logged.has(`${step}\n${message}`)) return;
      logged.add(`${step}\n${message}`);
      log(`storytree sessions list: ${step} failed: ${cause instanceof Error ? cause.stack ?? message : message}`);
    },
    recovered(): void {
      failures = [];
      logged.clear();
    },
    /** The banner at `at`, naming the last failure's step, with its message as the detail; none until failures persist. */
    banner(at: number): { text: string; detail: string } | undefined {
      const recent = failures.filter(failure => at - failure.at < windowMs);
      const last = recent.at(-1);
      if (recent.length < shown || last === undefined) return undefined;
      // The library unreachable is no read failing: it is said plainly, whichever read met it (7.34).
      if (saysUnreachable(last.message)) return { text: "The library cannot be reached. Retrying…", detail: last.message };
      return { text: `Sessions could not be refreshed: ${last.step} failed. Retrying…`, detail: last.message };
    },
  };
}

/** Whether a kept value is session rows, so rows kept by an older build are not drawn. */
export function isSessionRows(value: unknown): value is SessionRow[] {
  return Array.isArray(value) && value.every((row: Partial<SessionRow> | null) => typeof row === "object" && row !== null
    && typeof row.id === "string" && typeof row.label === "string" && typeof row.agent === "string" && typeof row.state === "string"
    && Array.isArray(row.stories) && Array.isArray(row.worktrees) && row.worktrees.every(tree => typeof tree?.path === "string") && Array.isArray(row.description) && isSessionRows(row.children));
}

function everyId(rows: readonly SessionRow[]): string[] {
  return rows.flatMap(row => [row.id, ...everyId(row.children)]);
}

/** The optional details seam takes already-read facts; it never asks for or parses transcripts. */
export function mountSessionsList(container: HTMLElement, options: {
  project: string;
  reads: SessionsReads;
  onHighlight(stories: readonly string[] | undefined): void;
  /** Hears each listed session's wisps (capability 5) whenever the rows are redrawn. */
  onWisps?(wisps: readonly SessionWisp[]): void;
  /** Hears every capability an open increment names (7.36), whenever the arcs are read, for the map's open-work dots. */
  onOpenWork?(capabilities: readonly string[]): void;
  /** Hears the listed rows as the knowledge core's roster whenever they are redrawn (ADR-0738 D2). */
  onRoster?(roster: readonly RosterEntry[]): void;
  /** A row was clicked: select its session, or undefined to clear the selection (ADR-0738 D5). */
  onSelect?(session: string | undefined): void;
  /** The page's one live reading, which the list hears; without it the list reads for itself. */
  reading?: PageReading;
  /** A saved recording's time; omitted by live hosts, which use the wall clock. */
  now?(): Date;
}) {
  const host = document.createElement("div");
  container.append(host);
  const root = createRoot(host);
  const now = options.now ?? (() => new Date());
  let tree: AnnotatedTree | undefined;
  let arcs: readonly ArcView[] | undefined;
  let log: readonly Line[] | LogReading = [];
  // The rows last drawn for this project, shown marked as refreshing until the first read lands.
  const kept = pageKept(`storytree.forest.sessions.v1:${options.project}`, isSessionRows);
  let rows: SessionRow[] = listedRows(kept.read() ?? []);
  let details: ReadonlyMap<string, SessionDetails> = new Map();
  let readings: ReadonlyMap<string, SessionDetails> = new Map();
  let quietMs: number | undefined;
  let leaveMs: number | undefined;
  let askedAt = -Infinity;
  let asking = false;
  let selected: string | undefined;
  // Every row starts collapsed; these are the ones the user opened.
  let expanded: ReadonlySet<string> = new Set();
  let stopped = false;
  const failures = refreshFailures(line => console.error(line));
  const outage = sessionsOutage();
  // A failure's banner is redrawn away once it ages out, even when no news or clock comes meanwhile.
  const ageing = new Set<ReturnType<typeof setTimeout>>();
  const draw = (): void => {
    const banner = failures.banner(Date.now());
    root.render(<SessionsList rows={rows} loading={tree === undefined && rows.length === 0}
    refreshing={tree === undefined && rows.length > 0}
    error={banner?.text} errorDetail={banner?.detail} selected={selected} onHighlight={options.onHighlight}
    expanded={expanded} onToggle={toggle}
    {...(options.onSelect ? { onSelect: options.onSelect } : {})} />);
  };
  /** Supplied details (showDetails) keep their parent; a reading supplies the tokens and groups. */
  const merged = (): ReadonlyMap<string, SessionDetails> => new Map([...new Set([...details.keys(), ...readings.keys()])]
    .map(id => [id, { ...details.get(id), ...readings.get(id) }]));
  const toggle = (session: string): void => {
    const next = new Set(expanded);
    if (!next.delete(session)) next.add(session);
    expanded = next;
    draw();
  };
  const askReadings = (): void => {
    if (options.reads.contextReadings === undefined || asking || Date.now() - askedAt < READING_EVERY_MS || rows.length === 0) return;
    asking = true;
    askedAt = Date.now();
    readContext(options.reads, options.project, everyId(rows), {
      idleAfterMs: ms => { quietMs = ms; },
      leaveAfterMs: ms => { leaveMs = ms; },
      readings: answers => { readings = new Map(answers.map(reading => [reading.session, detailsOf(reading)])); },
    }, outage).finally(() => {
      asking = false;
      if (!stopped) refresh(now(), false);
    });
  };
  const refresh = (now: Date, ask = true): void => {
    if (stopped || tree === undefined || arcs === undefined) return;
    // The list shows only the sessions at work (7.10); every session's claims still flag the map (capability 5).
    const all = sessionRows(tree, log, arcs, now, merged(), quietMs, leaveMs);
    rows = listedRows(all);
    kept.write(rows);
    options.onWisps?.(sessionWisps(all, log, now, quietMs));
    options.onRoster?.(sessionRoster(rows));
    draw();
    if (ask) askReadings();
  };
  draw();
  const own = options.reading === undefined ? pageReading({ project: options.project, reads: options.reads }) : undefined;
  const page = options.reading ?? own!;
  const stopHearing = page.subscribe({
    async onNews(news) {
      // Each read again only when the news changes what it is read from (7.24, ADR-0836 D3).
      const nextTree = await named("reading the project tree", () => treeAfter(options.reads, options.project, news, tree));
      const nextArcs = await named("reading the arcs", () => arcsAfter(options.reads, options.project, news, arcs));
      if (stopped) return;
      tree = nextTree;
      if (nextArcs !== arcs) options.onOpenWork?.(openWork(nextArcs));
      arcs = nextArcs;
      // The page reading holds the log once for every surface, folded and thinned to what they read (ADR-0836 D4).
      log = page.held();
      await named("drawing the rows", () => refresh(now()));
      failures.recovered();
      draw();
    },
    onClock(at) { refresh(options.now?.() ?? new Date(at)); },
    onError(error) {
      if (stopped) return;
      failures.failed(error, Date.now());
      const timer = setTimeout(() => { ageing.delete(timer); if (!stopped) draw(); }, FAILURES_WINDOW_MS);
      ageing.add(timer);
      draw();
    },
  });
  return {
    showDetails(next: ReadonlyMap<string, SessionDetails>) { details = next; refresh(now()); },
    /** Mark the session the knowledge core has selected, or none. */
    select(session: string | undefined) {
      selected = session;
      draw();
    },
    stop() {
      stopped = true;
      for (const timer of ageing) clearTimeout(timer);
      stopHearing();
      own?.stop();
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

/** A small branch: the worktree count's icon, drawn in the row's text colour. */
function WorktreeIcon() {
  return <svg className="session-worktrees-icon" viewBox="0 0 12 12" width={10} height={10} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.3}>
    <circle cx="3" cy="2.5" r="1.4" /><circle cx="3" cy="9.5" r="1.4" /><circle cx="9" cy="4" r="1.4" />
    <path d="M3 4v4M9 5.4c0 2-2 2.6-4.6 3.4" />
  </svg>;
}

function toggle(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** A worktree's folder name, the trunk's too, from its full path on any platform. */
const folderName = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** An expanded row's detail (7.8): its description's lines (7.14), then each worktree by its folder's name (full path on hover), labelled. */
function SessionDetail({ row }: { row: SessionRow }) {
  return <div className="session-detail">
    {row.description.length > 0 && <div className="session-description">{row.description.map(said => <p key={said}>{said}</p>)}</div>}
    {row.worktrees.length > 0 && <section className="session-detail-block">
      <p className="session-detail-label">Worktrees</p>
      <ul className="session-detail-worktrees" aria-label="Worktrees">
        {row.worktrees.map(tree => <li key={tree.path} title={[tree.path, ...tree.branches].join("\n")}>{folderName(tree.path)}
          {tree.state !== undefined && <span className="session-worktree-state" data-state={tree.state}>{tree.label ?? tree.state}</span>}</li>)}</ul></section>}
  </div>;
}

/**
 * Whether a row is known to be at work, itself or through a child (7.2): a child of it known to be idle is then greyed.
 * An observed subagent's state is not known, so it makes no parent read at work by itself.
 */
function busy(row: SessionRow): boolean {
  return !row.idle && row.state !== "observed" || row.children.some(busy);
}

export function SessionsList({ rows, loading = false, refreshing = false, error, errorDetail, selected, onHighlight, onSelect, ...control }: {
  rows: readonly SessionRow[];
  loading?: boolean;
  /** The rows are the ones last kept, drawn before this start's first read lands. */
  refreshing?: boolean;
  error?: string | undefined;
  /** What the error said, shown on the banner's hover. */
  errorDetail?: string | undefined;
  /** The session the knowledge core has selected. */
  selected?: string | undefined;
  onHighlight(stories: readonly string[] | undefined): void;
  onSelect?(session: string | undefined): void;
  /** The rows opened, when the caller keeps them; otherwise the list keeps its own. Every other row is collapsed (7.8). */
  expanded?: ReadonlySet<string>;
  onToggle?(session: string): void;
}) {
  const [own, setOwn] = useState<ReadonlySet<string>>(new Set());
  const expanded = control.expanded ?? own;
  const isOpen = (id: string): boolean => expanded.has(id);
  const onToggle = control.onToggle ?? ((id: string) => setOwn(toggle(own, id)));
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const visit = (list: readonly SessionRow[], depth: number, into: { row: SessionRow; depth: number }[] = []): { row: SessionRow; depth: number }[] => {
    for (const row of list) {
      into.push({ row, depth });
      if (isOpen(row.id)) visit(row.children, depth + 1, into);
    }
    return into;
  };
  // One list of the sessions at work (7.10), as the rows hold them.
  const visible = visit(rows, 0);
  const active = visible.find(({ row }) => row.id === (hovered ?? focused))?.row;
  const islands = active?.stories.join("\0");
  useEffect(() => {
    onHighlight(islands ? islands.split("\0") : undefined);
    return () => onHighlight(undefined);
  }, [islands, onHighlight]);
  useEffect(() => {
    document.body.dataset.drew = JSON.stringify({ ...JSON.parse(document.body.dataset.drew ?? "{}"),
      sessions: visible.map(({ row }) => row.id) });
  });
  /** A listed session's row and, opened, its detail and children (7.2, 7.8). */
  const sessionItem = ({ row, depth }: { row: SessionRow; depth: number }) => (
    <li key={row.id} style={{ marginLeft: Math.min(depth, 5) * 14 }}>
      <div className="session-row" data-session-id={row.id} data-state={row.state} data-idle={row.idle || undefined} data-done={depth > 0 && row.idle && !busy(row) || undefined}
        data-selected={row.id === selected || undefined} tabIndex={0}
        onClick={() => onSelect?.(clickedSelection(rows, row.id, selected))}
        onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault(); onSelect?.(clickedSelection(rows, row.id, selected)); } }}
        aria-label={`${row.label} · ${row.agent}${row.machine === undefined ? "" : ` on ${row.machine}`}`}
        onPointerEnter={() => setHovered(row.id)} onPointerLeave={() => setHovered(undefined)}
        onFocus={() => setFocused(row.id)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(undefined); }}>
        {/* One expander per row, at its start (7.8): its detail and its children (7.2), counted while folded by the "+N" after its name. */}
        <button type="button" className="session-children-toggle" aria-expanded={isOpen(row.id)}
          aria-label={`${isOpen(row.id) ? "Hide" : "Show"} detail${row.children.length > 0 ? ` and ${row.children.length} children` : ""} of ${row.label}`}
          onClick={event => { event.stopPropagation(); onToggle(row.id); }} />
        <span className="session-dot" data-dot={dotOf(row)} title={dotWords(row)} aria-hidden="true" />
        {depth === 0 && <span className="session-colour" style={{ background: sessionColour(row.id) }} aria-hidden="true" />}
        {/* The name and its machine (7.13): the machine wraps onto a hidden second line, so a narrow row drops it before the name is cut. */}
        <span className="session-name-fit"><span className="session-label" title={`${row.label}\n${row.agent} · ${row.id}${row.machine === undefined ? "" : ` · on ${row.machine}`}${row.state === "observed" ? "\nSubagent observed; current state unavailable" : ""}${row.worktrees.length > 0 ? `\n${row.worktrees.map(tree => tree.path).join("\n")}` : ""}`}>{row.label}</span>
        {row.machine !== undefined && <span className="session-machine" title={`Runs on ${row.machine}`}>{row.machine}</span>}</span>
        {row.children.length > 0 && !isOpen(row.id) && <span className="session-children" aria-hidden="true">+{row.children.length}</span>}
        {/* Its worktrees counted by a number beside a small branch icon (7.1), so the machine beside the name keeps its room (7.13). */}
        {row.worktrees.length > 1 && <span className="session-worktrees" title={row.worktrees.map(tree => tree.path).join("\n")}
          aria-label={`works in ${row.worktrees.length} worktrees`}><WorktreeIcon />{row.worktrees.length}</span>}
        <ContextBar row={row} />
        <span className="session-total" title={row.totalTokens === undefined ? "Context total unavailable" : `${row.totalTokens.toLocaleString("en-US")} context tokens`}>
          {row.totalTokens === undefined ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(row.totalTokens)}</span>
      </div>
      {isOpen(row.id) && <SessionDetail row={row} />}
    </li>);
  // The Sessions tab of the app's left rail (7.17): the list fills it, with no control of its own to hide or size it.
  return <aside className="sessions-list" data-fresh={refreshing ? "no" : undefined} aria-label="Running sessions">
    <header>
      <span className="sessions-name">Sessions <span className="sessions-count" title="Sessions at work or waiting for you">{rows.length}</span></span>
      <span className="session-legend" aria-label="Bar colours">
        {GROUPS.map(([group, name]) => <span key={group} data-group={group}><span className="session-swatch" aria-hidden="true" />{name}</span>)}
      </span>
    </header>
    <div id="sessions-body" className="sessions-body" data-surface-id="sessions">
    {loading && !error && <p role="status">Reading sessions…</p>}
    {refreshing && !error && <p role="status">As last read. Refreshing…</p>}
    {error && <p role="status" title={errorDetail}>{error}</p>}
    {!loading && rows.length === 0 && <p>No running sessions</p>}
    <ul>
      {visible.map(entry => sessionItem(entry))}
    </ul>
    </div>
  </aside>;
}

/**
 * A row's status dot, read from its recorded state alone (7.9, the owner's trial on question_66ebe5dc5eec): working, or with a
 * child at work; waiting for you within the idle-after time; otherwise idle. An observed subagent's state is not known, so its
 * dot is idle's and says so.
 */
function dotOf(row: SessionRow): "working" | "waiting" | "idle" {
  if (row.state === "working" || row.children.some(child => child.state === "working")) return "working";
  return row.state === "waiting" && !row.idle ? "waiting" : "idle";
}

/** What a row's dot means, on hover. */
function dotWords(row: SessionRow): string {
  const dot = dotOf(row);
  return dot === "idle" && row.state === "observed" ? "State unavailable" : { working: "Working", waiting: "Waiting for you", idle: "Idle" }[dot];
}
