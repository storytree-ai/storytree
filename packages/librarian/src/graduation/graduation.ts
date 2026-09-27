/**
 * Capability 4 · Graduation (the librarian story): a durable lesson moves out of the agent's
 * private memory into a principle, process or definition, and then the memory is deleted. Whether a
 * memory is durable is the agent's judgement (0.2's ADR-0095 D8); this is the worklist it judges
 * from, the park that keeps a reviewed memory quiet for 60 days (0.2's ADR-0202), the write that
 * deletes only after the library has the lesson (capture, then delete: ADR-0095 D6), and the check
 * that every process matches a tool served and every tool a process.
 *
 * A memory folder is laid out as Claude Code keeps one: one Markdown file per memory, and an index,
 * `MEMORY.md`, with a line per memory. The park ledger sits beside the folder, as 0.2's did
 * (`graduation-park.json`): machine-local, never in the library.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Library, Note, WriteOptions } from "@storytree/library";

import { allNotes, LibrarianRefusal } from "../notes.js";

/** The kinds a lesson graduates into. */
export type GraduationKind = "principle" | "process" | "definition";

/** A memory on the worklist: why it is there, and what it says. */
export interface MemoryItem {
  readonly file: string;
  /** New: never reviewed. Changed: edited since it was parked. Lapsed: parked more than 60 days ago, so "is this still alive?". */
  readonly why: "new" | "changed" | "lapsed";
  readonly text: string;
}

/** Processes that name none of the tools served, and tools served that no process names. */
export interface ProcessGaps {
  readonly processes: Note[];
  readonly tools: string[];
}

/** How long a park keeps a reviewed memory off the worklist. */
export const PARK_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;
const INDEX = "MEMORY.md";
const LEDGER = "graduation-park.json";

interface Park {
  readonly reason: string;
  readonly parkedAt: string;
  readonly hash: string;
}

/** Claude Code's memory folder for the project at `projectPath`: `<home>/.claude/projects/<slug>/memory`. */
export function claudeCodeMemoryFolder(projectPath: string, home: string): string {
  return path.join(home, ".claude", "projects", path.resolve(projectPath).replace(/[^A-Za-z0-9]/g, "-"), "memory");
}

/**
 * The worklist's graduation: each memory in `folders` that is new, changed since it was parked, or
 * parked more than 60 days before `now`, by file within each folder. A folder that does not exist
 * has none.
 */
export async function memoryWorklist(folders: readonly string[], { now = new Date() }: { now?: Date } = {}): Promise<MemoryItem[]> {
  const items: MemoryItem[] = [];
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    const ledger = readLedger(folder);
    for (const name of readdirSync(folder).filter((entry) => entry.endsWith(".md") && entry !== INDEX).sort()) {
      const file = path.join(folder, name);
      const text = readFileSync(file, "utf8");
      const parked = ledger[name];
      const why =
        parked === undefined ? "new" : parked.hash !== hashOf(text) ? "changed" : now.getTime() - Date.parse(parked.parkedAt) > PARK_DAYS * DAY ? "lapsed" : undefined;
      if (why !== undefined) items.push({ file, why, text });
    }
  }
  return items;
}

/** Park the memory `file`, reviewed and kept: its reason, the date, and a fingerprint of what it said, so an edit brings it back. */
export async function park(file: string, reason: string, { now = new Date() }: { now?: Date } = {}): Promise<void> {
  if (reason.trim() === "") throw new LibrarianRefusal("a memory is parked with its reason");
  const folder = path.dirname(file);
  const ledger = readLedger(folder);
  ledger[path.basename(file)] = { reason, parkedAt: now.toISOString(), hash: hashOf(readFileSync(file, "utf8")) };
  writeLedger(folder, ledger);
}

/**
 * Graduate the memory `file` into the library as a principle, process or definition with `fields`,
 * then delete it, with its index line and any park. A write the library refuses leaves the memory
 * as it was; any other kind is refused.
 */
export async function graduate(library: Library, file: string, kind: string, fields: Record<string, unknown>, writer?: WriteOptions): Promise<Note> {
  if (kind !== "principle" && kind !== "process" && kind !== "definition") {
    throw new LibrarianRefusal(`a lesson graduates into a principle, process or definition, not a ${kind}`);
  }
  if (!existsSync(file)) throw new LibrarianRefusal(`there is no memory ${file}`);
  const note: Note =
    kind === "definition" ? await library.defineTerm(fields as Parameters<Library["defineTerm"]>[0], writer) : await library.writeKnowledge(kind, fields as never, writer);
  forget(file);
  return note;
}

/** Each process whose `surfaces` names none of `tools`, and each tool of `tools` no process's `surfaces` names. */
export async function processGaps(library: Library, tools: readonly string[]): Promise<ProcessGaps> {
  const processes = (await allNotes(library)).filter((note): note is Extract<Note, { type: "process" }> => note.type === "process");
  const names = (note: Extract<Note, { type: "process" }>, tool: string): boolean => new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(note.fields.surfaces);
  return {
    processes: processes.filter((note) => !tools.some((tool) => names(note, tool))),
    tools: tools.filter((tool) => !processes.some((note) => names(note, tool))),
  };
}

/** Delete a graduated memory, its line in the folder's index, and its park. */
function forget(file: string): void {
  const folder = path.dirname(file);
  const name = path.basename(file);
  rmSync(file);
  const index = path.join(folder, INDEX);
  if (existsSync(index)) {
    const lines = readFileSync(index, "utf8").split("\n");
    writeFileSync(index, lines.filter((line) => !line.includes(`(${name})`)).join("\n"));
  }
  const ledger = readLedger(folder);
  if (name in ledger) {
    delete ledger[name];
    writeLedger(folder, ledger);
  }
}

function ledgerPath(folder: string): string {
  return path.join(path.dirname(folder), LEDGER);
}

function readLedger(folder: string): Record<string, Park> {
  const file = ledgerPath(folder);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, Park>) : {};
}

function writeLedger(folder: string, ledger: Record<string, Park>): void {
  writeFileSync(ledgerPath(folder), `${JSON.stringify(ledger, null, 2)}\n`);
}

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
