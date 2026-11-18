// Capability 3 · Hooks
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

import type { ActivityLog, DeliveredEvent, Earlier } from "../activity/index.js";
import type { NewLine } from "@storytree/library";

interface Queued {
  readonly project: string;
  readonly at: string;
  readonly line: NewLine;
  readonly event?: DeliveredEvent;
}

export function queueFolder(home: string): string {
  return path.join(home, "queued-lines");
}

export function enqueue(home: string, project: string, lines: readonly NewLine[], event?: DeliveredEvent): void {
  if (lines.length === 0) return;
  const folder = queueFolder(home);
  mkdirSync(folder, { recursive: true });
  const at = new Date();
  const machine = hostname().trim() || undefined;
  const text = lines.map((line): string => JSON.stringify({ project, at: at.toISOString(),
    line: line.machine !== undefined || machine === undefined ? line : { ...line, machine }, ...(event === undefined ? {} : { event }) } satisfies Queued)).join("\n");
  const name = `${String(at.getTime()).padStart(15, "0")}-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(path.join(folder, `${name}.part`), `${text}\n`);
  renameSync(path.join(folder, `${name}.part`), path.join(folder, `${name}.jsonl`));
}

export const UPLOAD_BATCH = 100;

export async function uploadQueued(home: string, log: ActivityLog, admits: (project: string, folder: string) => Promise<boolean>): Promise<void> {
  const answers = new Map<string, Promise<boolean>>();
  const admitted = (project: string, folder: string | undefined): Promise<boolean> => {
    if (folder === undefined) return Promise.resolve(false);
    const asked = JSON.stringify([project, folder]);
    let answer = answers.get(asked);
    if (answer === undefined) answers.set(asked, (answer = admits(project, folder)));
    return answer;
  };
  const folder = queueFolder(home);
  let names: string[];
  try {
    names = readdirSync(folder).filter((name) => name.endsWith(".jsonl")).sort();
  } catch {
    return;
  }
  let files: string[] = [];
  let batch = new Map<string, Earlier[]>();
  let count = 0;
  const send = async (): Promise<void> => {
    for (const [project, earlier] of batch) await log.appendMany(project, earlier);
    for (const file of files) rmSync(file, { force: true });
    [files, batch, count] = [[], new Map(), 0];
  };
  for (const name of names) {
    const file = path.join(folder, name);
    let waiting: Queued[];
    try {
      waiting = readFileSync(file, "utf8").split("\n").filter((text) => text.trim() !== "").map((text) => JSON.parse(text) as Queued);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      renameSync(file, `${file}.unreadable`);
      continue;
    }
    for (const { project, at, line, event } of waiting) {
      if (!(await admitted(project, line.folder))) continue;
      const lines = batch.get(project) ?? [];
      lines.push({ line, at, ...(event === undefined ? {} : { event }) });
      batch.set(project, lines);
      count += 1;
    }
    files.push(file);
    if (count >= UPLOAD_BATCH) await send();
  }
  await send();
}
