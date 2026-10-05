/**
 * Writing a capability's files claims it (ADR-0924), off the agent's path: the once-a-minute upkeep
 * copy of a hook reads the edits this machine's sessions made since its last look, and claims each
 * edited file's capability for its session, unless the session already holds it or another live
 * session does (D1). Nothing is ever stopped (D2): an edit to a capability another live session holds
 * claims nothing and records a claim-refused line naming the file. Each session is told on this
 * machine, at its next prompt (notices.ts): what was claimed for it and from which file, so it can
 * release a wrong guess (D3); and, as editor, who holds what it edited. A holder is told of an edit to
 * what it holds by the look on its own machine, which reads every machine's refusals.
 *
 * Which capability a file belongs to is one seam (`CapabilityLookup`, D5 still open). For now it is
 * the code survey's answer (packages/map): a file belongs to the capability whose numbered tests reach
 * it nearest. A file the survey places nowhere claims nothing (D4). Any failure claims nothing and
 * says nothing.
 *
 * Where the last look got to is kept on this machine, per project: a look reads only what came after,
 * and only edits from the last 15 minutes count, so a first look, or one after a long gap, claims
 * nothing for work long done.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Library } from "@storytree/library";

import type { ActivityLog, Line } from "../activity/index.js";
import { labelOf } from "../readings.js";
import { claim, CLAIM_REASON_LIMIT, type Claim } from "./claims.js";
import { leaveNotice } from "./notices.js";

/** Which capability each of `files` (absolute paths in the checkout at `checkout`) belongs to; a file that belongs to none is absent. */
export type CapabilityLookup = (checkout: string, files: readonly string[]) => Promise<ReadonlyMap<string, string>>;

export interface EditClaimsContext {
  readonly log: ActivityLog;
  readonly library: Library;
  readonly project: string;
  /** The storytree home: where the last look's place and the sessions' notices are kept. */
  readonly home: string;
  /** This machine: only edits written here are claimed from. By default, edits from any machine. */
  readonly machine?: string;
  readonly lookup?: CapabilityLookup;
}

/** How old an edit may be and still claim. */
const RECENT_MS = 15 * 60 * 1000;

/** One look: claim from the edits since the last, and leave each session what it should be told. Never throws. */
export async function claimFromEdits(context: EditClaimsContext): Promise<void> {
  try {
    const { log, library, project, home, machine } = context;
    const place = placeFile(home, project);
    const last = readPlace(place);
    // Only the recent edits and refusals since the last look are read, never the rest of the log (contract 2.7).
    const from = last === undefined ? 0 : Math.min(last.edits, last.notices);
    const since = new Date(Date.now() - RECENT_MS).toISOString();
    const read = await log.lines(project, { kinds: ["file-edited", "claim-refused"], after: from, since, omit: ["transcript"] });
    const cursor = Math.max(read.at(-1)?.seq ?? from, last?.edits ?? 0);
    const recent = (line: Line) => Date.now() - Date.parse(line.at) <= RECENT_MS;
    const edits = read.filter((line): line is Extract<Line, { kind: "file-edited" }> =>
      line.kind === "file-edited" && line.seq > (last?.edits ?? 0) && recent(line) && line.folder !== undefined && (machine === undefined || line.machine === machine));
    // Where this look got to is kept before claiming: a look cut short claims each edit at most once.
    writePlace(place, { edits: cursor, notices: last?.notices ?? 0 });

    // The plan's titles, read only when there is an edit to claim from or a refusal to tell of: most looks have neither.
    let known: Promise<Map<string, string>> | undefined;
    const titlesOf = () => (known ??= library.projectTree().then((tree) => new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id, title }) => [id, title] as const)))));
    const lookup = context.lookup ?? surveyLookup(library);
    const done = new Set<string>();
    const titles = edits.length === 0 ? new Map<string, string>() : await titlesOf();
    for (const [checkout, lines] of byFolder(edits)) {
      const owners = await lookup(checkout, lines.flatMap((line) => line.files.map((file) => path.resolve(checkout, file)))).catch(() => new Map<string, string>());
      for (const line of lines) {
        for (const edited of line.files) {
          const full = path.resolve(checkout, edited);
          const capability = owners.get(full);
          const title = capability === undefined ? undefined : titles.get(capability);
          if (capability === undefined || title === undefined || done.has(`${line.session}\n${capability}`)) continue;
          done.add(`${line.session}\n${capability}`);
          const file = path.relative(checkout, full).split(path.sep).join("/");
          const answer = await claim({ log, library, project, session: line.session, ...(line.harness === undefined ? {} : { harness: line.harness }), source: "hook", folder: checkout, ...(line.branch === undefined ? {} : { branch: line.branch }) },
            capability, [...title].slice(0, CLAIM_REASON_LIMIT).join("").trim(), { file });
          if (answer.ok && answer.alreadyHeld !== true) leaveNotice(home, line.session, claimedNotice(title, capability, file));
          else if (!answer.ok && answer.refused === "held") leaveNotice(home, line.session, heldNotice(title, file, answer.holder));
        }
      }
    }

    // Edits to what a session here holds, by any session on any machine, including this look's own.
    const added = await log.lines(project, { kinds: ["claim-refused"], after: cursor, since, omit: ["transcript"] });
    for (const line of [...read, ...added]) {
      if (line.kind !== "claim-refused" || line.file === undefined || line.capability === undefined || line.seq <= (last?.notices ?? 0) || !recent(line)) continue;
      leaveNotice(home, line.holder, editedNotice((await titlesOf()).get(line.capability) ?? line.capability, line.file, line));
    }
    writePlace(place, { edits: cursor, notices: Math.max(added.at(-1)?.seq ?? cursor, last?.notices ?? 0) });
  } catch {
    // Whatever went wrong, nothing more is claimed or said.
  }
}

function claimedNotice(title: string, capability: string, file: string): string {
  return `[storytree] Your edit to ${file} claimed "${title}" (${capability}) for you. If you are not writing that capability, release it: the release tool, or \`storytree workspace release ${capability}\`.`;
}

function heldNotice(title: string, file: string, holder: Claim): string {
  return `[storytree] Your edit to ${file} is in "${title}", which ${holder.label} session ${holder.session} holds (${holder.reason}). Your edit stands and nothing was claimed: coordinate, move on, or carry on by your own judgement.`;
}

function editedNotice(title: string, file: string, editor: Line): string {
  return `[storytree] ${labelOf(editor.harness)} session ${editor.session} edited ${file}, in "${title}", which you hold. Its edit stands: coordinate, or carry on by your own judgement.`;
}

/** Edits grouped by the checkout their session worked in, in order. */
function byFolder(edits: readonly Extract<Line, { kind: "file-edited" }>[]): Map<string, Extract<Line, { kind: "file-edited" }>[]> {
  const grouped = new Map<string, Extract<Line, { kind: "file-edited" }>[]>();
  for (const line of edits) grouped.set(line.folder!, [...(grouped.get(line.folder!) ?? []), line]);
  return grouped;
}

/** The code survey's answer, of the checkout the edit was made in (ADR-0924 D5's interim lookup). */
function surveyLookup(library: Library): CapabilityLookup {
  return async (checkout, files) => {
    const [{ codeSurveyReader, packageOf }, tree] = await Promise.all([import("@storytree/map/code-survey"), library.projectTree()]);
    const survey = await codeSurveyReader({ checkout: "current" }).read(checkout, tree);
    const owners = new Map<string, string>();
    for (const story of tree.stories) {
      const root = path.join(checkout, "packages", packageOf(story.title));
      for (const file of survey[story.id]?.files ?? []) if (file.capability !== undefined) owners.set(path.resolve(root, file.path), file.capability);
    }
    return new Map(files.flatMap((file) => (owners.has(file) ? [[file, owners.get(file)!] as const] : [])));
  };
}

interface Place {
  readonly edits: number;
  readonly notices: number;
}

function placeFile(home: string, project: string): string {
  return path.join(home, "edit-claims", `${encodeURIComponent(project)}.json`);
}

function readPlace(file: string): Place | undefined {
  try {
    const { edits, notices } = JSON.parse(readFileSync(file, "utf8")) as Partial<Place>;
    return Number.isSafeInteger(edits) && Number.isSafeInteger(notices) ? { edits: edits!, notices: notices! } : undefined;
  } catch {
    return undefined;
  }
}

function writePlace(file: string, place: Place): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(place));
}
