// Capability 3 · Reads by session and agent
import type { Line } from "@storytree/library";

export const NO_RECORDED_READS = "no recorded reads";

export const REACH_DAYS = 90;
const WEIGHT = { whole: 1, peek: 0.3 } as const;

export interface Lit {
  note: string;
  read: "peek" | "whole";
  seq: number;
  at: string;
}

export interface Jump {
  from: string | undefined;
  to: string;
  move: "jump";
  seq: number;
  at: string;
}

export interface AgentReplay {
  agent: string;
  label: string;
  type?: string;
  task?: string;
  known: boolean;
  lit: Lit[];
  jumps: Jump[];
}

export interface Replay {
  agents: AgentReplay[];
  missing: Map<string, number>;
}

type NoteRead = Extract<Line, { kind: "note-read" }>;
type Started = Extract<Line, { kind: "subagent-started" }>;

export class ReadRecord {
  #project: string;
  #seen = new Set<number>();
  #reads: NoteRead[] = [];
  #started = new Map<string, Started>();

  constructor(project: string) {
    this.#project = project;
  }

  add(lines: readonly Line[]): void {
    for (const line of lines) {
      if (line.project !== this.#project || (line.kind !== "note-read" && line.kind !== "subagent-started") || this.#seen.has(line.seq)) continue;
      this.#seen.add(line.seq);
      if (line.kind === "note-read") this.#reads.push(line);
      else if (line.kind === "subagent-started") this.#started.set(`${line.session} ${line.subagent}`, line);
    }
    this.#reads.sort((a, b) => a.seq - b.seq);
  }

  switchTo(project: string): void {
    this.#project = project;
    this.#seen.clear();
    this.#reads = [];
    this.#started.clear();
  }

  sessions(): string[] {
    return [...new Set(this.#reads.map(({ session }) => session))];
  }

  visits(note: string): number {
    return new Set(this.#reads.filter((read) => read.note === note).map(({ session }) => session)).size;
  }

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

  status(): string | undefined {
    return this.#reads.length === 0 ? NO_RECORDED_READS : undefined;
  }

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
