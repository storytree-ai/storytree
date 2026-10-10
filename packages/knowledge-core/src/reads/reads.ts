/** Capability 3 · Reads by session and agent. Capability 3's founding book (R1, T1): reads by session and agent, from Session management's activity log. */
import type { Line } from "@storytree/session-management";

/** What the picture says when the log holds no reads: never that the knowledge went unused. */
export const NO_RECORDED_READS = "no recorded reads";

/** How far back a note's reach looks (ADR-0926 D1). */
export const REACH_DAYS = 90;
/** What a session's strongest read of a note weighs in its reach: a peek counts for less than a whole read. */
const WEIGHT = { whole: 1, peek: 0.3 } as const;

/** One read that lights its note. */
export interface Lit {
  note: string;
  read: "peek" | "whole";
  seq: number;
  at: string;
}

/** A known agent's move to a full read: always a jump, since the record names no source note. */
export interface Jump {
  from: string | undefined;
  to: string;
  move: "jump";
  seq: number;
  at: string;
}

/** One agent of one session, replayed in recorded order. */
export interface AgentReplay {
  /** "orchestrator", "unknown", or "subagent:<the harness's id>". */
  agent: string;
  /** Only what the harness recorded: its type, else its id. */
  label: string;
  type?: string;
  task?: string;
  /** False for "unknown": its notes light pale, with no path. */
  known: boolean;
  lit: Lit[];
  jumps: Jump[];
}

export interface Replay {
  agents: AgentReplay[];
  /** Reads of notes no longer present, by note, with how many. */
  missing: Map<string, number>;
}

type NoteRead = Extract<Line, { kind: "note-read" }>;
type Started = Extract<Line, { kind: "subagent-started" }>;

/**
 * A project's recorded reads, kept in memory and fed from the activity log's lines as the page
 * reads them (from 0, then its new lines). Each read and subagent line is taken once, by its number,
 * so lines read twice count once; no other line is kept, not even its number. It owns no store:
 * switching projects starts again.
 */
export class ReadRecord {
  #project: string;
  #seen = new Set<number>();
  #reads: NoteRead[] = [];
  /** What each subagent-started line said of a subagent, by session and id. */
  #started = new Map<string, Started>();

  constructor(project: string) {
    this.#project = project;
  }

  /** Take lines from the log; lines of another project, or already taken, change nothing. */
  add(lines: readonly Line[]): void {
    for (const line of lines) {
      if (line.project !== this.#project || (line.kind !== "note-read" && line.kind !== "subagent-started") || this.#seen.has(line.seq)) continue;
      this.#seen.add(line.seq);
      if (line.kind === "note-read") this.#reads.push(line);
      else if (line.kind === "subagent-started") this.#started.set(`${line.session} ${line.subagent}`, line);
    }
    this.#reads.sort((a, b) => a.seq - b.seq);
  }

  /** Start again for another project. */
  switchTo(project: string): void {
    this.#project = project;
    this.#seen.clear();
    this.#reads = [];
    this.#started.clear();
  }

  /** The sessions with reads, in the order of their first read. */
  sessions(): string[] {
    return [...new Set(this.#reads.map(({ session }) => session))];
  }

  /** How many distinct sessions peeked at or read the note. */
  visits(note: string): number {
    return new Set(this.#reads.filter((read) => read.note === note).map(({ session }) => session)).size;
  }

  /**
   * Each read note's reach (ADR-0926 D1): the distinct sessions that read it in the REACH_DAYS before
   * `now`, each counted once at the weight of its strongest read (a whole read 1, a peek 0.3).
   */
  reach(now: number): Map<string, number> {
    const since = now - REACH_DAYS * 86_400_000;
    const strongest = new Map<string, Map<string, number>>();
    for (const { note, session, read, at } of this.#reads) {
      const when = Date.parse(at);
      if (!(when >= since && when <= now)) continue;
      const sessions = strongest.get(note) ?? strongest.set(note, new Map()).get(note)!;
      sessions.set(session, Math.max(sessions.get(session) ?? 0, WEIGHT[read]));
    }
    return new Map([...strongest].map(([note, sessions]) => [note, [...sessions.values()].reduce((a, b) => a + b, 0)]));
  }

  totals(note: string): { peeks: number; wholes: number } {
    const of = this.#reads.filter((read) => read.note === note);
    return { peeks: of.filter(({ read }) => read === "peek").length, wholes: of.filter(({ read }) => read === "whole").length };
  }

  /**
   * One session's reads, agent by agent, in recorded order (line number). Every read of a present
   * note lights it. A known agent's whole reads are its stops, each reached by a jump from its
   * previous stop; a peek moves no stop. "unknown", or no agent at all, has no path.
   */
  replay(session: string, present: ReadonlySet<string>): Replay {
    const agents = new Map<string, AgentReplay>();
    const missing = new Map<string, number>();
    for (const read of this.#reads) {
      if (read.session !== session) continue;
      if (!present.has(read.note)) {
        missing.set(read.note, (missing.get(read.note) ?? 0) + 1);
        continue;
      }
      const who = this.#who(read);
      let replay = agents.get(who.agent);
      if (replay === undefined) agents.set(who.agent, (replay = { ...who, lit: [], jumps: [] }));
      replay.lit.push({ note: read.note, read: read.read, seq: read.seq, at: read.at });
      if (replay.known && read.read === "whole") {
        replay.jumps.push({ from: replay.jumps.at(-1)?.to, to: read.note, move: "jump", seq: read.seq, at: read.at });
      }
    }
    return { agents: [...agents.values()], missing };
  }

  /** NO_RECORDED_READS while no read has been taken. */
  status(): string | undefined {
    return this.#reads.length === 0 ? NO_RECORDED_READS : undefined;
  }

  /** Who made a read: only what the harness recorded, on the read or when the subagent started. */
  #who(read: NoteRead): Omit<AgentReplay, "lit" | "jumps"> {
    const agent = read.agent ?? "unknown";
    if (agent === "orchestrator") return { agent, label: "orchestrator", known: true };
    if (agent === "unknown") return { agent, label: "unknown agent", known: false };
    const started = this.#started.get(`${read.session} ${agent.subagent}`);
    const type = agent.type ?? started?.type;
    const task = agent.task ?? started?.task;
    return { agent: `subagent:${agent.subagent}`, label: type ?? `subagent ${agent.subagent}`, ...(type === undefined ? {} : { type }), ...(task === undefined ? {} : { task }), known: true };
  }
}
