/**
 * Capability 5 · Claims: a session's file-edit tools are refused before the edit, on a capability its
 * claimed increment's capabilities list does not name, or one another live session holds, by its own
 * claim or on the list of an increment it holds (ADR-0949 D3). The refusal names the holder, or the
 * way through: add the capability to the increment's list and claim it. This reverses ADR-0924 D2 for
 * the edit tools; edits through the shell are never stopped, but are caught after the command by the hooks' shell
 * guard, which asks here what the gate would have refused (shellEditRefusals) or, in imported code, what no yes covers,
 * and tells the agent. Nothing claims after the edit: ADR-0953 D5 retired ADR-0924's edit claims and their notices.
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
 * yes, asked before the edit (an "ask"), because an agent writes its own increments (ADR-1015 D2). One yes covers the
 * increment (contract 5.41): the capabilities its list named when the user gave it, over the files each covered then. A
 * capability listed later, or a cover widened since, is asked again. The yes is a `user-allowed` line, written only by
 * the hook after an edit the harness's prompt let through, by a command the user types at their own terminal, or by the
 * prompt hook that heard the user say that command in the conversation, which counts for that session alone (5.42): a
 * line any other way writes is not read as one, and no tool writes one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { AnnotatedStory, AnnotatedTree, Library, PendingChange, SchemaRecord } from "@storytree/library";

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
export async function editRefusal(context: GateContext, checkout: string, files: readonly EditedFile[], declared: DeclaredCapabilities, imports: readonly ImportedFolderPlace[] = []): Promise<EditRefusal | undefined> {
  return refusalOf(context, checkout, files, declared, imports, true);
}

/** What the gate reads and writes through: the session's log, its project's library, and who it is. */
export type GateContext = Pick<ClaimContext, "log" | "library" | "project" | "session" | "harness" | "folder" | "quietMs" | "restarted">;

/** The gate's answer; `noting` writes the claim-refused line, which an edit that already happened must not. */
async function refusalOf(context: GateContext, checkout: string, files: readonly EditedFile[], declared: DeclaredCapabilities, imports: readonly ImportedFolderPlace[], noting: boolean): Promise<EditRefusal | undefined> {
  return (await refusalsOf(context, checkout, files, declared, imports, noting, false))[0];
}

/** The gate's refusals: the first alone, or with `every` each capability's (an edit that already happened has no imported files here). */
async function refusalsOf(context: GateContext, checkout: string, files: readonly EditedFile[], declared: DeclaredCapabilities, imports: readonly ImportedFolderPlace[], noting: boolean, every: boolean): Promise<EditRefusal[]> {
  const inImports = files.flatMap((file) => {
    const absolute = path.resolve(checkout, file.path);
    const imported = imports.find(({ folder }) => isWithin(absolute, folder));
    return imported === undefined ? [] : [{ imported, relative: path.relative(imported.folder, absolute).split(path.sep).join("/") }];
  });
  const placed = files.map((file) => ({ ...file, relative: path.relative(checkout, path.resolve(checkout, file.path)).split(path.sep).join("/") }))
    .filter(({ relative }) => relative.startsWith("packages/") || relative.startsWith("apps/desktop/"));
  if (placed.length === 0 && inImports.length === 0) return [];
  const [tree, claims] = await Promise.all([
    context.library.projectTree(),
    readClaims(context.log, context.project, {
      ...(context.quietMs === undefined ? {} : { quietMs: context.quietMs }),
      ...(context.restarted === undefined ? {} : { restarted: context.restarted }),
    }),
  ]);
  const mine = claims.filter((claim) => claim.session === context.session && claim.increment !== undefined);
  const others = claims.filter((claim) => claim.session !== context.session && claim.holder === "live");
  const plans = new Map(await Promise.all([...mine, ...others.filter((claim) => claim.increment !== undefined)].map(async (claim) => [claim.increment!, await planOf(context.library, claim.increment!)] as const)));
  const lists = new Map([...plans].map(([increment, { capabilities }]) => [increment, capabilities] as const));

  const explored = inImports.map(({ imported, relative }) => ({ imported, file: relative, covering: coveringOf(tree, imported, relative) }));
  const moves = [...new Set(mine.map((claim) => claim.increment!))].flatMap((increment) => plans.get(increment)!.pending);
  const owners = [
    ...explored.flatMap(({ covering, file }) => (covering === undefined ? [] : [{ ...covering, file }])),
    ...(placed.length === 0 ? [] : await declaredOwners(tree, moves, checkout, placed, declared)),
  ];
  if (owners.length === 0 && explored.length === 0) return [];

  const driving = mine.at(-1)?.increment;
  const refusals: EditRefusal[] = [];
  for (const { capability, title, file } of owners) {
    const held = holderOf(capability, context.session, claims, lists);
    const holder = held?.holder;
    const listing = held?.on === undefined ? undefined : held.holder;
    if (holder !== undefined) {
      if (noting) await context.log.append(context.project, {
        session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: "hook", ...(context.folder === undefined ? {} : { folder: context.folder }),
        kind: "claim-refused", capability, holder: holder.session, reason: `edit to ${file} refused before it happened`, ...(driving === undefined ? {} : { under: driving }),
      });
      refusals.push({ refused: "held", capability, title, file, holder, ...(listing === undefined ? {} : { on: listing.increment! }) });
      if (every) continue;
      return refusals;
    }
    if (driving !== undefined && !mine.some((claim) => lists.get(claim.increment!)!.includes(capability))) {
      if (explored.some((edit) => edit.file === file && edit.covering?.capability === capability)) continue;
      refusals.push({ refused: "unlisted", capability, title, file, increment: driving, listed: lists.get(driving)! });
      if (!every) return refusals;
    }
  }
  if (refusals.length > 0) return refusals;
  // Imported code: the increment must list the explored capability covering the file, and the user must have said yes, or be asked.
  const listedByMe = (capability: string): boolean => mine.some((claim) => lists.get(claim.increment!)!.includes(capability));
  let yeses: Promise<AllowedCapability[]> | undefined;
  let ask: EditRefusal | undefined;
  for (const { imported, file, covering } of explored) {
    if (driving === undefined || covering === undefined || !listedByMe(covering.capability)) {
      return [{ refused: "imported", file, folder: imported.folder, ...(driving === undefined ? {} : { increment: driving }), ...(covering === undefined ? {} : { covering }) }];
    }
    yeses ??= yesesOn(context, [...new Set(mine.map((claim) => claim.increment!))]);
    if ((await yeses).some((yes) => yes.capability === covering.capability && covered(yes.covers, file))) continue;
    ask ??= { refused: "ask", file, folder: imported.folder, capability: covering.capability, title: covering.title, increment: driving };
  }
  return ask === undefined ? [] : [ask];
}

/**
 * Who holds `capability` against `session`, of `claims`: another live session by its own claim, or, unless `session`
 * claimed it itself, one holding an increment whose list in `lists` names it (`on`); undefined when none does.
 */
export function holderOf(capability: string, session: string, claims: readonly Claim[], lists: ReadonlyMap<string, readonly string[]>): { holder: Claim; on?: string } | undefined {
  const others = claims.filter((claim) => claim.session !== session && claim.holder === "live");
  const direct = others.find((claim) => claim.capability === capability);
  if (direct !== undefined) return { holder: direct };
  // A capability the session claimed for itself is its own, whichever other increment lists it.
  if (claims.some((claim) => claim.capability === capability && claim.session === session)) return undefined;
  const listing = others.find((claim) => claim.increment !== undefined && (lists.get(claim.increment) ?? []).includes(capability));
  return listing === undefined ? undefined : { holder: listing, on: listing.increment! };
}

/** A capability a user's yes named, with what it covered then. */
interface AllowedCapability {
  readonly capability: string;
  readonly covers: string[];
}

/**
 * The capabilities the user said yes to on `increments`, from the lines the gate trusts: a prompt's, written by the
 * hook, a command's, typed by a person at their own terminal, or one said in the conversation, written by the prompt
 * hook of this session (ADR-1015 D2). A said yes counts for the session that heard it alone, because an agent could
 * start a harness of its own from its shell whose prompt hook would hear the command from it (5.42).
 */
async function yesesOn(context: GateContext, increments: readonly string[]): Promise<AllowedCapability[]> {
  const lines = await context.log.lines(context.project, { kinds: ["user-allowed"], where: { increment: increments } });
  return lines.flatMap((line) => {
    if (line.kind !== "user-allowed") return [];
    const trusted =
      line.how === "prompt" ? line.source === "hook"
      : line.how === "said" ? line.source === "hook" && line.session === context.session
      : line.source === "tool" && line.session.startsWith("person:");
    return trusted ? line.capabilities : [];
  });
}

/** Whether `file` (relative to its imported folder, forward slashes) is under one of `covers`. */
function covered(covers: readonly string[], file: string): boolean {
  return covers.some((cover) => cover === "." || file === cover || file.startsWith(`${cover}/`));
}

/** What a yes on `increment` names: each capability on its list now, with the folders and files it covers now. */
async function allowedNow(library: Library, increment: string): Promise<AllowedCapability[]> {
  const [listed, tree] = await Promise.all([listOf(library, increment), library.projectTree()]);
  const covers = new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id, covers: its }) => [id, its ?? []] as const)));
  return listed.map((capability) => ({ capability, covers: [...(covers.get(capability) ?? [])] }));
}

/**
 * After an edit tool changed `files`: when the gate would have asked the user for it, the harness's prompt asked, and
 * the edit happening is the user's yes, so it is recorded on the increment for the edits after it (contract 5.41).
 * Only a hook calls this, after the harness ran the edit. Returns the increment the yes was recorded on, if any.
 */
export async function recordPromptYes(context: GateContext, checkout: string, files: readonly EditedFile[], imports: readonly ImportedFolderPlace[]): Promise<string | undefined> {
  const imported = files.filter((file) => imports.some(({ folder }) => isWithin(path.resolve(checkout, file.path), folder)));
  if (imported.length === 0) return undefined;
  const refusal = await refusalOf(context, checkout, imported, async () => new Map(), imports, false);
  if (refusal?.refused !== "ask") return undefined;
  await context.log.append(context.project, {
    session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: "hook", ...(context.folder === undefined ? {} : { folder: context.folder }),
    kind: "user-allowed", increment: refusal.increment, how: "prompt", capabilities: await allowedNow(context.library, refusal.increment),
  });
  return refusal.increment;
}

/**
 * Of `files` in imported folders, which a shell command already changed, those the gate would have refused or asked
 * about: no yes of the user's on the session's increment covers them. Writes nothing, since the change already happened.
 */
export async function unallowedImportEdits(context: GateContext, checkout: string, files: readonly EditedFile[], imports: readonly ImportedFolderPlace[]): Promise<EditedFile[]> {
  const unallowed = async (some: readonly EditedFile[]) => (await refusalOf(context, checkout, some, async () => new Map(), imports, false)) !== undefined;
  if (!(await unallowed(files))) return [];
  const found: EditedFile[] = [];
  for (const file of files) if (await unallowed([file])) found.push(file);
  return found;
}

/**
 * Of `files` in the checkout, which a shell command already changed, what the gate would have refused had an edit tool
 * made the change: one refusal for each capability unlisted or held. Writes nothing, since the change already happened.
 */
export async function shellEditRefusals(context: GateContext, checkout: string, files: readonly EditedFile[], declared: DeclaredCapabilities): Promise<EditRefusal[]> {
  return refusalsOf(context, checkout, files, declared, [], false, true);
}

/** What the user's yes from their own terminal recorded, or why it was not. */
export type AllowAnswer = { readonly ok: true; readonly capabilities: readonly AllowedCapability[] } | { readonly ok: false; readonly reason: string };

/**
 * The user's yes, typed at their own terminal, to changing imported code for `increment` (contract 5.41): for a harness
 * that cannot ask them at the edit. `person` is who typed it; the front door gives it only from a terminal no agent
 * session runs, so an agent never writes it for itself (ADR-1015 D2).
 */
export async function allowIncrement(context: Pick<ClaimContext, "log" | "library" | "project" | "folder">, person: string, increment: string): Promise<AllowAnswer> {
  return recordYes(context, increment, { session: `person:${person}`, source: "tool", how: "command" });
}

/**
 * The user's yes to changing imported code for `increment`, said in the conversation as the allow command on its own line
 * of their own message (contract 5.42): for a harness that cannot ask them at the edit. Only the prompt hook calls this,
 * with the session whose user sent the message, and the yes counts for that session alone.
 */
export async function allowSaid(context: GateContext, increment: string): Promise<AllowAnswer> {
  return recordYes(context, increment, { session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: "hook", how: "said" });
}

/** Record the user's yes on `increment`, as `by` gave it, over what it lists now; refused when it is no increment or lists nothing. */
async function recordYes(context: Pick<ClaimContext, "log" | "library" | "project" | "folder">, increment: string, by: { session: string; harness?: string; source: "tool" | "hook"; how: "command" | "said" }): Promise<AllowAnswer> {
  const record = await context.library.get(increment);
  if (record?.type !== "increment") return { ok: false, reason: `${increment} is not an increment of this project.` };
  const capabilities = await allowedNow(context.library, increment);
  if (capabilities.length === 0) return { ok: false, reason: `${increment} lists no capabilities yet, so a yes would allow nothing: the agent lists the explored capability it means to change first.` };
  await context.log.append(context.project, { ...by, ...(context.folder === undefined ? {} : { folder: context.folder }), kind: "user-allowed", increment, capabilities });
  return { ok: true, capabilities };
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
    const found = story.capabilities.find(({ covers }) => covered(covers ?? [], file));
    if (found !== undefined) return { capability: found.id, title: found.title };
  }
  return undefined;
}

/** What the agent is told when its edit is refused, or `after` its shell command made it: why, and the way through. */
export function refusalMessage(refusal: EditRefusal, after = false): string {
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
    return `[storytree] This edit changes ${refusal.file} in ${refusal.folder}, your original project imported into storytree, for "${refusal.title}" (${refusal.capability}) on increment ${refusal.increment}. Imported code is changed only on your explicit permission (ADR-1015): allow it only if you want the agent to change your original code for this increment; one yes covers the increment's other edits to what it lists now. Where no prompt can appear (a headless run), the user allows it by sending ${allowCommand(refusal.increment)} on its own line as their own message, or by running it at their own terminal.`;
  }
  const what = `"${refusal.title}" (${refusal.capability})`;
  const lead = after ? `Your last shell command changed ${refusal.file}, which an edit tool would have been refused` : `Your edit to ${refusal.file} was refused before it happened`;
  if (refusal.refused === "held") {
    const where = refusal.on === undefined ? "holds it" : `holds it on the capabilities list of ${refusal.on}`;
    return `[storytree] ${lead}: it is in ${what}, and ${refusal.holder.label} session ${refusal.holder.session} ${where} (${refusal.holder.reason}). Back off (ADR-0944 D3): ${after ? "undo your change there, " : ""}push what is unfinished to its branch, name that branch in the increment's residue, release your claims, and take other work.`;
  }
  const list = [...refusal.listed, refusal.capability].join(",");
  return `[storytree] ${lead}: it is in ${what}, which the capabilities list of your increment ${refusal.increment} does not name (ADR-0949 D3). If you mean to change it, add it to the list and claim it${after ? "" : ", then edit again"}: the edit_plan and claim tools, or \`storytree arc increment edit ${refusal.increment} --capabilities ${list}\` and \`storytree workspace claim ${refusal.capability} --reason …\`${after ? "; if not, undo your change there" : ""}.`;
}

/** The command a user types at their own terminal, or sends on its own line as their own message, to allow `increment`'s changes to imported code; an agent's shell is refused it. */
export function allowCommand(increment: string): string {
  return `storytree workspace allow ${increment}`;
}

/**
 * The capability each of `files` declares, in the plan's stories, in order; a file that declares none is left out. The
 * session's increments' pending `moves` place a file first (ADR-0966): a capability they move or renumber answers to its
 * new number in its new story and in its old one, whose packages still hold its code while the branch is open, so a fold
 * that renumbers a package's tests is placed against the plan its branch merges into. The live plan places the rest.
 */
async function declaredOwners(tree: AnnotatedTree, moves: readonly PendingChange[], checkout: string, files: readonly (EditedFile & { relative: string })[], declared: DeclaredCapabilities): Promise<{ capability: string; title: string; file: string }[]> {
  const texts = new Map(files.map((file) => [file.relative, file.text] as const));
  const readText = (file: string) => texts.get(file) ?? readFileSync(path.join(checkout, file), "utf8");
  const moved = movedOnly(tree, moves);
  const first = moved === undefined ? new Map<string, string>() : await declared(checkout, [...texts.keys()], moved, readText);
  const rest = [...texts.keys()].filter((file) => !first.has(file));
  const placed = new Map([...first, ...(rest.length === 0 ? [] : await declared(checkout, rest, tree, readText))]);
  const titles = new Map([...tree.stories, ...(moved?.stories ?? [])].flatMap((story) => story.capabilities.map(({ id, title }) => [id, title] as const)));
  const owners: { capability: string; title: string; file: string }[] = [];
  for (const file of texts.keys()) {
    const capability = placed.get(file);
    if (capability === undefined) continue;
    if (!owners.some((owner) => owner.capability === capability)) owners.push({ capability, title: titles.get(capability)!, file });
  }
  return owners;
}

/**
 * `tree` holding only the capabilities `moves` move or renumber, each under its new title in its new story and its old
 * one; undefined when they move none.
 */
function movedOnly(tree: AnnotatedTree, moves: readonly PendingChange[]): AnnotatedTree | undefined {
  const changed = new Map(moves.flatMap((move) => ("after" in move && move.type === "capability" && (typeof move.after.title === "string" || typeof move.after.story === "string") ? [[move.record, move.after] as const] : [])));
  if (changed.size === 0) return undefined;
  const stories = tree.stories.map((story) => ({ ...story, capabilities: [] as AnnotatedStory["capabilities"] }));
  for (const story of tree.stories) {
    for (const capability of story.capabilities) {
      const after = changed.get(capability.id);
      if (after === undefined) continue;
      const moved = { ...capability, title: typeof after.title === "string" ? after.title : capability.title };
      const to = typeof after.story === "string" ? after.story : story.id;
      for (const holder of stories) if (holder.id === story.id || holder.id === to) holder.capabilities.push(moved);
    }
  }
  return { ...tree, stories };
}

/** The capabilities list and pending plan changes of `increment`: none when it has none or is not an increment. */
async function planOf(library: Library, increment: string): Promise<{ capabilities: readonly string[]; pending: readonly PendingChange[] }> {
  const record = await library.get(increment);
  const fields = record?.type === "increment" ? (record as SchemaRecord<"increment">).fields : undefined;
  return { capabilities: fields?.capabilities ?? [], pending: fields?.pending ?? [] };
}

/** The capabilities list of `increment`: none when it has none or is not an increment. */
export async function listOf(library: Library, increment: string): Promise<readonly string[]> {
  return (await planOf(library, increment)).capabilities;
}
