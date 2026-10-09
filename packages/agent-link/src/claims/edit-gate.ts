/**
 * Capability 5 · Claims: a session's file-edit tools are refused before the edit, on a capability its
 * claimed increment's capabilities list does not name, or one another live session holds, by its own
 * claim or on the list of an increment it holds (ADR-0949 D3). The refusal names the holder, or the
 * way through: add the capability to the increment's list and claim it. This reverses ADR-0924 D2 for
 * the edit tools; edits through the shell are still never stopped. Nothing claims after the edit:
 * ADR-0953 D5 retired ADR-0924's edit claims and their notices.
 *
 * Only a file's own declaration places it here (an opening "Capability N · <title>", or a test file's
 * one numbered capability): the code survey's inference is too slow for a hook the harness waits on,
 * and too often wrong to stop work on. A file that declares nothing is never refused; the landing
 * check at gate and CI reads the branch's whole change. A session that holds no increment is refused
 * only what another holds: there is no list to read.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Library, SchemaRecord } from "@storytree/library";

import { readClaims, type Claim, type ClaimContext } from "./claims.js";

/** A file an edit tool is about to write, and its text after the edit when the tool gives it whole (a new file has none on disk yet). */
export interface EditedFile {
  readonly path: string;
  readonly text?: string;
}

export type EditRefusal =
  | { readonly refused: "unlisted"; readonly capability: string; readonly title: string; readonly file: string; readonly increment: string; readonly listed: readonly string[] }
  | { readonly refused: "held"; readonly capability: string; readonly title: string; readonly file: string; readonly holder: Claim; readonly on?: string };

/**
 * Why the context's session may not edit `files` in the checkout at `checkout` now, or undefined when
 * it may. A refusal because another live session holds the capability writes a claim-refused line, so
 * the activity log shows who was turned away and by whom.
 */
export async function editRefusal(context: Pick<ClaimContext, "log" | "library" | "project" | "session" | "harness" | "folder" | "quietMs" | "restarted">, checkout: string, files: readonly EditedFile[]): Promise<EditRefusal | undefined> {
  const placed = files.map((file) => ({ ...file, relative: path.relative(checkout, path.resolve(checkout, file.path)).split(path.sep).join("/") }))
    .filter(({ relative }) => relative.startsWith("packages/") || relative.startsWith("apps/desktop/"));
  if (placed.length === 0) return undefined;
  const owners = await declaredOwners(context.library, checkout, placed);
  if (owners.length === 0) return undefined;

  const claims = await readClaims(context.log, context.project, {
    ...(context.quietMs === undefined ? {} : { quietMs: context.quietMs }),
    ...(context.restarted === undefined ? {} : { restarted: context.restarted }),
  });
  const mine = claims.filter((claim) => claim.session === context.session && claim.increment !== undefined);
  const others = claims.filter((claim) => claim.session !== context.session && claim.holder === "live");
  const lists = new Map(await Promise.all([...mine, ...others.filter((claim) => claim.increment !== undefined)].map(async (claim) => [claim.increment!, await listOf(context.library, claim.increment!)] as const)));

  for (const { capability, title, file } of owners) {
    const direct = others.find((claim) => claim.capability === capability);
    // A capability the session claimed for itself is its own, whichever other increment lists it.
    const owned = claims.some((claim) => claim.capability === capability && claim.session === context.session);
    const listing = direct === undefined && !owned ? others.find((claim) => claim.increment !== undefined && lists.get(claim.increment)!.includes(capability)) : undefined;
    const holder = direct ?? listing;
    if (holder !== undefined) {
      await context.log.append(context.project, {
        session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: "hook", ...(context.folder === undefined ? {} : { folder: context.folder }),
        kind: "claim-refused", capability, holder: holder.session, reason: `edit to ${file} refused before it happened`,
      });
      return { refused: "held", capability, title, file, holder, ...(listing === undefined ? {} : { on: listing.increment! }) };
    }
    const driving = mine.at(-1)?.increment;
    if (driving !== undefined && !mine.some((claim) => lists.get(claim.increment!)!.includes(capability))) {
      return { refused: "unlisted", capability, title, file, increment: driving, listed: lists.get(driving)! };
    }
  }
  return undefined;
}

/** What the agent is told when its edit is refused: why, and the way through. */
export function refusalMessage(refusal: EditRefusal): string {
  const what = `"${refusal.title}" (${refusal.capability})`;
  if (refusal.refused === "held") {
    const where = refusal.on === undefined ? "holds it" : `holds it on the capabilities list of ${refusal.on}`;
    return `[storytree] Your edit to ${refusal.file} was refused before it happened: it is in ${what}, and ${refusal.holder.label} session ${refusal.holder.session} ${where} (${refusal.holder.reason}). Back off (ADR-0944 D3): push what is unfinished to its branch, name that branch in the increment's residue, release your claims, and take other work.`;
  }
  const list = [...refusal.listed, refusal.capability].join(",");
  return `[storytree] Your edit to ${refusal.file} was refused before it happened: it is in ${what}, which the capabilities list of your increment ${refusal.increment} does not name (ADR-0949 D3). If you mean to change it, add it to the list and claim it, then edit again: the edit_plan and claim tools, or \`storytree arc increment edit ${refusal.increment} --capabilities ${list}\` and \`storytree workspace claim ${refusal.capability} --reason …\`.`;
}

/** The capability each of `files` declares, in the plan's stories, in order; a file that declares none is left out. */
async function declaredOwners(library: Library, checkout: string, files: readonly (EditedFile & { relative: string })[]): Promise<{ capability: string; title: string; file: string }[]> {
  const [{ capabilitiesOfFiles }, tree] = await Promise.all([import("@storytree/map/code-survey"), library.projectTree()]);
  const texts = new Map(files.map((file) => [file.relative, file.text] as const));
  // The map's shared lookup, its declared half only: the survey's inference is never read here.
  const placed = await capabilitiesOfFiles(checkout, [...texts.keys()], tree, {
    readText: (file) => texts.get(file) ?? readFileSync(path.join(checkout, file), "utf8"),
    survey: async () => ({}),
  });
  const titles = new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id, title }) => [id, title] as const)));
  const owners: { capability: string; title: string; file: string }[] = [];
  for (const [file, { capability, inferred }] of placed) {
    if (!inferred && !owners.some((owner) => owner.capability === capability)) owners.push({ capability, title: titles.get(capability)!, file });
  }
  return owners;
}

/** The capabilities list of `increment`: none when it has none or is not an increment. */
async function listOf(library: Library, increment: string): Promise<readonly string[]> {
  const record = await library.get(increment);
  return record?.type === "increment" ? ((record as SchemaRecord<"increment">).fields.capabilities ?? []) : [];
}
