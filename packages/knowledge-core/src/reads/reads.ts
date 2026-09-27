/** Capability 3's founding book (R1, T1): reads by session and agent, from the agent link's activity log. */
import type { Line } from "@storytree/agent-link";

/** What the picture says when the log holds no reads: never that the knowledge went unused. */
export const NO_RECORDED_READS = "no recorded reads";

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

export class ReadRecord {
  constructor(project: string) {
    void project;
  }

  /** Take lines from the log; lines of another project, or already taken, change nothing. */
  add(_lines: readonly Line[]): void {}

  /** Start again for another project. */
  switchTo(_project: string): void {}

  /** The sessions with reads, in the order of their first read. */
  sessions(): string[] {
    return [];
  }

  /** How many distinct sessions peeked at or read the note. */
  visits(_note: string): number {
    return -1;
  }

  totals(_note: string): { peeks: number; wholes: number } {
    return { peeks: -1, wholes: -1 };
  }

  replay(_session: string, _present: ReadonlySet<string>): Replay {
    return { agents: [], missing: new Map() };
  }

  /** NO_RECORDED_READS while no read has been taken. */
  status(): string | undefined {
    return undefined;
  }
}
