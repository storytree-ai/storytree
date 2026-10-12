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
 * and too often wrong to stop work on. That rule is the map's, so the gate is given it as a lookup by
 * whoever runs it (the app setup's hook command, ADR-0969) and never imports the map itself. A file that
 * declares nothing is never refused; the landing check at gate and CI reads the branch's whole change. A
 * session that holds no increment is refused only what another holds: there is no list to read.
 *
 * A file in a folder the project imports is the user's original code (ADR-0993 D4, ADR-1015). It is placed by its
 * path against the imported folders and the covers of the explored capabilities of the stories mapped from them,
 * cheap enough for the hook. It is refused unless the session's increment lists the explored capability that covers
 * it, a session holding no increment included; when the increment does list it, the edit still needs the user's own
 * yes, asked before the edit (an "ask"), because an agent writes its own increments (ADR-1015 D2).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { AnnotatedTree, Library, SchemaRecord } from "@storytree/library";

import { readClaims, type Claim, type ClaimContext } from "./claims.js";

/** A file an edit tool is about to write, and its text after the edit when the tool gives it whole (a new file has none on disk yet). */
export interface EditedFile {
  readonly path: string;
  readonly text?: string;
}

/**
 * The capability each of `files` (repo-relative to `checkout`, forward slashes) declares of `tree`'s, by
 * its own declaration alone, keyed by file; a file that declares none is left out. `readText` gives a
 * file's text, the edit's own when the tool gave it.
 */
export type DeclaredCapabilities = (checkout: string, files: readonly string[], tree: AnnotatedTree, readText: (file: string) => string) => Promise<ReadonlyMap<string, string>>;

/** A folder the project imports: its folder on this machine, and the repository a mapped story may name it by. */
export interface ImportedFolderPlace {
  readonly folder: string;
  readonly repository?: string;
}

export type EditRefusal =
  | { readonly refused: "imported"; readonly file: string; readonly folder: string; readonly increment?: string; readonly covering?: { readonly capability: string; readonly title: string } }
  | { readonly refused: "ask"; readonly file: string; readonly folder: string; readonly capability: string; readonly title: string; readonly increment: string }
  | { readonly refused: "unlisted"; readonly capability: string; readonly title: string; readonly file: string; readonly increment: string; readonly listed: readonly string[] }
  | { readonly refused: "held"; readonly capability: string; readonly title: string; readonly file: string; readonly holder: Claim; readonly on?: string };

/**
 * Why the context's session may not edit `files` in the checkout at `checkout` now, or undefined when
 * it may; `declared` places each file in its capability. A refusal because another live session holds the capability writes a claim-refused line, so
 * the activity log shows who was turned away and by whom.
 */
export async function editRefusal(context: Pick<ClaimContext, "log" | "library" | "project" | "session" | "harness" | "folder" | "quietMs" | "restarted">, checkout: string, files: readonly EditedFile[], declared: DeclaredCapabilities, imports: readonly ImportedFolderPlace[] = []): Promise<EditRefusal | undefined> {
  const inImports = files.flatMap((file) => {
    const absolute = path.resolve(checkout, file.path);
    const imported = imports.find(({ folder }) => isWithin(absolute, folder));
    return imported === undefined ? [] : [{ imported, relative: path.relative(imported.folder, absolute).split(path.sep).join("/") }];
  });
  const placed = files.map((file) => ({ ...file, relative: path.relative(checkout, path.resolve(checkout, file.path)).split(path.sep).join("/") }))
    .filter(({ relative }) => relative.startsWith("packages/") || relative.startsWith("apps/desktop/"));
  if (placed.length === 0 && inImports.length === 0) return undefined;
  const tree = await context.library.projectTree();
  const explored = inImports.map(({ imported, relative }) => ({ imported, file: relative, covering: coveringOf(tree, imported, relative) }));
  const owners = [
    ...explored.flatMap(({ covering, file }) => (covering === undefined ? [] : [{ ...covering, file }])),
    ...(placed.length === 0 ? [] : await declaredOwners(tree, checkout, placed, declared)),
  ];
  if (owners.length === 0 && explored.length === 0) return undefined;

  const claims = await readClaims(context.log, context.project, {
    ...(context.quietMs === undefined ? {} : { quietMs: context.quietMs }),
    ...(context.restarted === undefined ? {} : { restarted: context.restarted }),
  });
  const mine = claims.filter((claim) => claim.session === context.session && claim.increment !== undefined);
  const others = claims.filter((claim) => claim.session !== context.session && claim.holder === "live");
  const lists = new Map(await Promise.all([...mine, ...others.filter((claim) => claim.increment !== undefined)].map(async (claim) => [claim.increment!, await listOf(context.library, claim.increment!)] as const)));

  const driving = mine.at(-1)?.increment;
  for (const { capability, title, file } of owners) {
    const direct = others.find((claim) => claim.capability === capability);
    // A capability the session claimed for itself is its own, whichever other increment lists it.
    const owned = claims.some((claim) => claim.capability === capability && claim.session === context.session);
    const listing = direct === undefined && !owned ? others.find((claim) => claim.increment !== undefined && lists.get(claim.increment)!.includes(capability)) : undefined;
    const holder = direct ?? listing;
    if (holder !== undefined) {
      await context.log.append(context.project, {
        session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: "hook", ...(context.folder === undefined ? {} : { folder: context.folder }),
        kind: "claim-refused", capability, holder: holder.session, reason: `edit to ${file} refused before it happened`, ...(driving === undefined ? {} : { under: driving }),
      });
      return { refused: "held", capability, title, file, holder, ...(listing === undefined ? {} : { on: listing.increment! }) };
    }
    if (driving !== undefined && !mine.some((claim) => lists.get(claim.increment!)!.includes(capability))) {
      if (explored.some((edit) => edit.file === file && edit.covering?.capability === capability)) continue;
      return { refused: "unlisted", capability, title, file, increment: driving, listed: lists.get(driving)! };
    }
  }
  // Imported code: the increment must list the explored capability covering the file, and the user must then say yes.
  const listedByMe = (capability: string): boolean => mine.some((claim) => lists.get(claim.increment!)!.includes(capability));
  let ask: EditRefusal | undefined;
  for (const { imported, file, covering } of explored) {
    if (driving === undefined || covering === undefined || !listedByMe(covering.capability)) {
      return { refused: "imported", file, folder: imported.folder, ...(driving === undefined ? {} : { increment: driving }), ...(covering === undefined ? {} : { covering }) };
    }
    ask ??= { refused: "ask", file, folder: imported.folder, capability: covering.capability, title: covering.title, increment: driving };
  }
  return ask;
}

/** Whether `file` is `folder` or lies under it, both absolute. */
function isWithin(file: string, folder: string): boolean {
  const relative = path.relative(path.resolve(folder), file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** The explored capability covering `file` (relative to `imported`, forward slashes) on a story mapped from `imported`; covers never overlap within a story. */
function coveringOf(tree: AnnotatedTree, imported: ImportedFolderPlace, file: string): { capability: string; title: string } | undefined {
  for (const story of tree.stories) {
    const from = story.mapped?.from;
    if (from === undefined || (from !== imported.repository && path.resolve(from) !== path.resolve(imported.folder))) continue;
    const found = story.capabilities.find(({ covers }) => (covers ?? []).some((cover) => cover === "." || file === cover || file.startsWith(`${cover}/`)));
    if (found !== undefined) return { capability: found.id, title: found.title };
  }
  return undefined;
}

/** What the agent is told when its edit is refused: why, and the way through. */
export function refusalMessage(refusal: EditRefusal): string {
  if (refusal.refused === "imported") {
    const where = `${refusal.file} in ${refusal.folder}, code the project imports`;
    const covered = refusal.covering === undefined
      ? "No explored capability covers it yet: draw the capability you mean to change (plan_capability, with the folders and files it covers)"
      : `It is in the explored capability "${refusal.covering.title}" (${refusal.covering.capability})`;
    const listing = refusal.increment === undefined
      ? "and list it on an increment you hold (park_increment and make_workspace)"
      : `and list it on your increment ${refusal.increment} (edit_plan, or \`storytree arc increment edit ${refusal.increment} --capabilities ${refusal.covering?.capability ?? "<capability>"}\` with the ones it lists already)`;
    return `[storytree] Your edit to ${where}, was refused before it happened: imported code is changed only when your increment names its explored capability, and then only on the user's yes (ADR-0993 D4, ADR-1015). ${covered}, ${listing}, then edit again; or ask the user what to do: change it there, bring that part into storytree, retire it, or leave it.`;
  }
  if (refusal.refused === "ask") {
    return `[storytree] This edit changes ${refusal.file} in ${refusal.folder}, your original project imported into storytree, for "${refusal.title}" (${refusal.capability}) on increment ${refusal.increment}. Imported code is changed only on your explicit permission (ADR-1015): allow it only if you want the agent to change your original code here.`;
  }
  const what = `"${refusal.title}" (${refusal.capability})`;
  if (refusal.refused === "held") {
    const where = refusal.on === undefined ? "holds it" : `holds it on the capabilities list of ${refusal.on}`;
    return `[storytree] Your edit to ${refusal.file} was refused before it happened: it is in ${what}, and ${refusal.holder.label} session ${refusal.holder.session} ${where} (${refusal.holder.reason}). Back off (ADR-0944 D3): push what is unfinished to its branch, name that branch in the increment's residue, release your claims, and take other work.`;
  }
  const list = [...refusal.listed, refusal.capability].join(",");
  return `[storytree] Your edit to ${refusal.file} was refused before it happened: it is in ${what}, which the capabilities list of your increment ${refusal.increment} does not name (ADR-0949 D3). If you mean to change it, add it to the list and claim it, then edit again: the edit_plan and claim tools, or \`storytree arc increment edit ${refusal.increment} --capabilities ${list}\` and \`storytree workspace claim ${refusal.capability} --reason …\`.`;
}

/** The capability each of `files` declares, in the plan's stories, in order; a file that declares none is left out. */
async function declaredOwners(tree: AnnotatedTree, checkout: string, files: readonly (EditedFile & { relative: string })[], declared: DeclaredCapabilities): Promise<{ capability: string; title: string; file: string }[]> {
  const texts = new Map(files.map((file) => [file.relative, file.text] as const));
  const placed = await declared(checkout, [...texts.keys()], tree, (file) => texts.get(file) ?? readFileSync(path.join(checkout, file), "utf8"));
  const titles = new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id, title }) => [id, title] as const)));
  const owners: { capability: string; title: string; file: string }[] = [];
  for (const [file, capability] of placed) {
    if (!owners.some((owner) => owner.capability === capability)) owners.push({ capability, title: titles.get(capability)!, file });
  }
  return owners;
}

/** The capabilities list of `increment`: none when it has none or is not an increment. */
async function listOf(library: Library, increment: string): Promise<readonly string[]> {
  const record = await library.get(increment);
  return record?.type === "increment" ? ((record as SchemaRecord<"increment">).fields.capabilities ?? []) : [];
}
