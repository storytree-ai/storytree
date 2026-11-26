// Capability 24 · Graduation
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Note } from "../../knowledge/index.js";
import type { WriteOptions } from "../../records/index.js";

import { allNotes, LibrarianRefusal, type LibrarianLibrary } from "../notes.js";

export type GraduationKind = "principle" | "process" | "definition";

export interface MemoryItem {
  readonly file: string;
  readonly why: "new" | "changed" | "lapsed";
  readonly text: string;
}

export interface ProcessGaps {
  readonly processes: Note[];
  readonly tools: string[];
}

export const PARK_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;
const INDEX = "MEMORY.md";
const LEDGER = "graduation-park.json";

interface Park {
  readonly reason: string;
  readonly parkedAt: string;
  readonly hash: string;
}

export function claudeCodeMemoryFolder(projectPath: string, home: string): string {
  return path.join(home, ".claude", "projects", path.resolve(projectPath).replace(/[^A-Za-z0-9]/g, "-"), "memory");
}

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

export async function park(file: string, reason: string, { now = new Date() }: { now?: Date } = {}): Promise<void> {
  if (reason.trim() === "") throw new LibrarianRefusal("a memory is parked with its reason");
  const folder = path.dirname(file);
  const ledger = readLedger(folder);
  ledger[path.basename(file)] = { reason, parkedAt: now.toISOString(), hash: hashOf(readFileSync(file, "utf8")) };
  writeLedger(folder, ledger);
}

export async function graduate(library: LibrarianLibrary, file: string, kind: string, fields: Record<string, unknown>, writer?: WriteOptions): Promise<Note> {
  if (kind !== "principle" && kind !== "process" && kind !== "definition") {
    throw new LibrarianRefusal(`a lesson graduates into a principle, process or definition, not a ${kind}`);
  }
  if (!existsSync(file)) throw new LibrarianRefusal(`there is no memory ${file}`);
  const note: Note =
    kind === "definition" ? await library.defineTerm(fields as Parameters<LibrarianLibrary["defineTerm"]>[0], writer) : await library.writeKnowledge(kind, fields as never, writer);
  forget(file);
  return note;
}

export async function processGaps(library: LibrarianLibrary, tools: readonly string[], read: Promise<readonly Note[]> | readonly Note[] = allNotes(library)): Promise<ProcessGaps> {
  const processes = (await read).filter((note): note is Extract<Note, { type: "process" }> => note.type === "process");
  const names = (note: Extract<Note, { type: "process" }>, tool: string): boolean => new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(note.fields.surfaces);
  return {
    processes: processes.filter((note) => !tools.some((tool) => names(note, tool))),
    tools: tools.filter((tool) => !processes.some((note) => names(note, tool))),
  };
}

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
