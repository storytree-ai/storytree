// Capability 24 · Graduation
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Library, WriteOptions } from "../../index.js";
import type { NewDefinition, NewKnowledge, Note } from "../notes/index.js";
import { LibrarianRefusal, notesOf, type NotesRead } from "./links.js";

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

interface Parked {
  readonly reason: string;
  readonly parkedAt: string;
  readonly hash: string;
  readonly text: string;
}

export const PARK_DAYS = 60;

const DAY = 24 * 60 * 60 * 1000;
const KINDS: readonly string[] = ["principle", "process", "definition"];
const INDEX = "MEMORY.md";

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function ledgerOf(folder: string): string {
  return path.join(path.dirname(folder), "graduation-park.json");
}

function readLedger(folder: string): Record<string, Parked> {
  const file = ledgerOf(folder);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, Parked>) : {};
}

export function claudeCodeMemoryFolder(projectPath: string, home: string): string {
  return path.join(home, ".claude", "projects", projectPath.replace(/[^A-Za-z0-9]/g, "-"), "memory");
}

export async function memoryWorklist(folders: readonly string[], { now = new Date() }: { now?: Date } = {}): Promise<MemoryItem[]> {
  const items: MemoryItem[] = [];
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    const ledger = readLedger(folder);
    for (const name of readdirSync(folder).filter((one) => one.endsWith(".md") && one !== INDEX).sort()) {
      const file = path.join(folder, name);
      const text = readFileSync(file, "utf8");
      const parked = ledger[name];
      const why = parked === undefined ? "new" : parked.hash !== hashOf(text) ? "changed" : now.getTime() - Date.parse(parked.parkedAt) > PARK_DAYS * DAY ? "lapsed" : undefined;
      if (why !== undefined) items.push({ file, why, text });
    }
  }
  return items;
}

export async function park(file: string, reason: string, { now = new Date() }: { now?: Date } = {}): Promise<void> {
  if (!existsSync(file)) throw new LibrarianRefusal(`${file} is not a memory file: only a memory that exists is parked`);
  const folder = path.dirname(file);
  const text = readFileSync(file, "utf8");
  const ledger = { ...readLedger(folder), [path.basename(file)]: { reason, parkedAt: now.toISOString(), hash: hashOf(text), text } };
  writeFileSync(ledgerOf(folder), `${JSON.stringify(ledger, null, 2)}\n`);
}

export async function graduate(library: Library, file: string, kind: string, fields: Record<string, unknown>, writer?: WriteOptions): Promise<Note> {
  if (!KINDS.includes(kind)) throw new LibrarianRefusal(`a memory graduates as a principle, process or definition, not a ${kind}: nothing was written and ${file} stays`);
  if (!existsSync(file)) throw new LibrarianRefusal(`${file} is not a memory file: only a memory that exists graduates`);
  const blank = Object.entries(fields).filter(([, value]) => typeof value === "string" && value.trim() === "").map(([field]) => field);
  if (blank.length > 0) throw new LibrarianRefusal(`${blank.join(", ")} is blank: a graduated lesson says every field, so nothing was written and ${file} stays`);
  const note = kind === "definition"
    ? await library.defineTerm(fields as NewDefinition, writer)
    : await library.writeKnowledge(kind as Exclude<GraduationKind, "definition">, fields as NewKnowledge<Exclude<GraduationKind, "definition">>, writer);
  rmSync(file);
  const index = path.join(path.dirname(file), INDEX);
  if (existsSync(index)) {
    const named = `](${path.basename(file)})`;
    writeFileSync(index, readFileSync(index, "utf8").split("\n").filter((line) => !line.includes(named)).join("\n"));
  }
  return note;
}

function mentions(note: Note, tool: string): boolean {
  const name = new RegExp(`(?<![\\w-])${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);
  return Object.values(note.fields as Record<string, unknown>).some((value) => typeof value === "string" && name.test(value));
}

export async function processGaps(library: Library, tools: readonly string[], read?: NotesRead): Promise<ProcessGaps> {
  const processes = (await notesOf(library, read)).filter((note) => note.type === "process");
  return {
    processes: processes.filter((process) => !tools.some((tool) => mentions(process, tool))),
    tools: tools.filter((tool) => !processes.some((process) => mentions(process, tool))),
  };
}
