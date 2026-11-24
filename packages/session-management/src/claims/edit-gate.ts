// Capability 5 · Claims
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import type { AnnotatedStory, AnnotatedTree, Library, PendingChange, SchemaRecord } from "@storytree/library";

import { readClaims, type Claim, type ClaimContext } from "./claims.js";
import { lapseMessage, lapsesOf, type Lapse } from "./lapses.js";

export interface EditedFile {
  readonly path: string;
  readonly text?: string;
}

export type DeclaredCapabilities = (checkout: string, files: readonly string[], tree: AnnotatedTree, readText: (file: string) => string) => Promise<ReadonlyMap<string, string>>;

export type ReadsCode = (file: string) => Promise<boolean>;

export interface ImportedFolderPlace {
  readonly folder: string;
  readonly repository?: string;
}

export type ListedCover = { readonly capability: string; readonly title: string; readonly covers: readonly string[] };

export type EditRefusal = (
  | { readonly refused: "imported"; readonly file: string; readonly folder: string; readonly increment?: string; readonly covering?: { readonly capability: string; readonly title: string }; readonly listed?: readonly ListedCover[]; readonly drawn?: "on-disk" | "new" | "unread" }
  | { readonly refused: "ask"; readonly file: string; readonly folder: string; readonly capability: string; readonly title: string; readonly increment: string }
  | { readonly refused: "unlisted"; readonly capability: string; readonly title: string; readonly file: string; readonly increment: string; readonly listed: readonly string[] }
  | { readonly refused: "held"; readonly capability: string; readonly title: string; readonly file: string; readonly holder: Claim; readonly on?: string }
) & { readonly lapsed?: readonly Lapse[] };

export async function editRefusal(context: GateContext, checkout: string, files: readonly EditedFile[], declared: DeclaredCapabilities, imports: readonly ImportedFolderPlace[] = [], readsCode?: ReadsCode, isCode?: ReadsCode, factory?: string): Promise<EditRefusal | undefined> {
  return refusalOf(context, checkout, files, declared, imports, true, readsCode, isCode, factory);
}

export type GateContext = Pick<ClaimContext, "log" | "library" | "project" | "session" | "harness" | "folder" | "quietMs" | "restarted">;

async function refusalOf(context: GateContext, checkout: string, files: readonly EditedFile[], declared: DeclaredCapabilities, imports: readonly ImportedFolderPlace[], noting: boolean, readsCode?: ReadsCode, isCode?: ReadsCode, factory?: string): Promise<EditRefusal | undefined> {
  return (await refusalsOf(context, checkout, files, declared, imports, noting, false, readsCode, isCode, factory))[0];
}

async function refusalsOf(context: GateContext, checkout: string, files: readonly EditedFile[], declared: DeclaredCapabilities, imports: readonly ImportedFolderPlace[], noting: boolean, every: boolean, readsCode?: ReadsCode, isCode?: ReadsCode, factory?: string): Promise<EditRefusal[]> {
  const located = files.flatMap((file) => {
    const absolute = path.resolve(checkout, file.path);
    const imported = imports.find(({ folder }) => isWithin(absolute, folder));
    return imported === undefined ? [] : [{ imported, relative: path.relative(imported.folder, absolute).split(path.sep).join("/") }];
  });
  const inImports = isCode === undefined ? located : (await Promise.all(located.map(async (one) => ((await isCode(one.relative)) ? [one] : [])))).flat();
  const placed = files.flatMap((file) => {
    const absolute = path.resolve(checkout, file.path);
    const relative = path.relative(checkout, absolute).split(path.sep).join("/");
    if (relative.startsWith("packages/") || relative.startsWith("apps/desktop/")) return [{ ...file, root: checkout, relative }];
    const root = factory === undefined || isWithin(absolute, checkout) ? undefined : factoryCheckoutOf(absolute, factory);
    const within = root === undefined ? undefined : path.relative(root, absolute).split(path.sep).join("/");
    return root !== undefined && within!.startsWith("plugins/") ? [{ ...file, root, relative: within! }] : [];
  });
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
    ...(placed.length === 0 ? [] : await declaredOwners(tree, moves, placed, declared)),
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
      return withLapses(context, claims, refusals);
    }
    if (driving !== undefined && !mine.some((claim) => lists.get(claim.increment!)!.includes(capability))) {
      if (explored.some((edit) => edit.file === file && edit.covering?.capability === capability)) continue;
      refusals.push({ refused: "unlisted", capability, title, file, increment: driving, listed: lists.get(driving)! });
      if (!every) return refusals;
    }
  }
  if (refusals.length > 0) return withLapses(context, claims, refusals);
  const listedByMe = (capability: string): boolean => mine.some((claim) => lists.get(claim.increment!)!.includes(capability));
  let yeses: Promise<AllowedCapability[]> | undefined;
  let ask: EditRefusal | undefined;
  for (const { imported, file, covering } of explored) {
    if (driving === undefined || covering === undefined || !listedByMe(covering.capability)) {
      const listed = driving === undefined || covering !== undefined ? [] : listedOf(tree, imported, lists.get(driving)!);
      const drawn = covering === undefined && readsCode !== undefined ? await drawnOf(tree, imported, file, readsCode) : undefined;
      return withLapses(context, claims, [{ refused: "imported", file, folder: imported.folder, ...(driving === undefined ? {} : { increment: driving }), ...(covering === undefined ? {} : { covering }), ...(listed.length === 0 ? {} : { listed }), ...(drawn === undefined ? {} : { drawn }) }]);
    }
    yeses ??= yesesOn(context, [...new Set(mine.map((claim) => claim.increment!))]);
    if ((await yeses).some((yes) => yes.capability === covering.capability && covered(yes.covers, file))) continue;
    ask ??= { refused: "ask", file, folder: imported.folder, capability: covering.capability, title: covering.title, increment: driving };
  }
  return ask === undefined ? [] : [ask];
}

async function withLapses(context: GateContext, claims: readonly Claim[], refusals: EditRefusal[]): Promise<EditRefusal[]> {
  if (claims.some((claim) => claim.session === context.session && claim.increment !== undefined)) return refusals;
  const lapsed = (await lapsesOf(context.log, context.project, context.session)).filter((lapse) => lapse.by === "takeover" || !claims.some((claim) => claim.increment === lapse.increment));
  return lapsed.length === 0 ? refusals : refusals.map((refusal) => ({ ...refusal, lapsed }));
}

export function holderOf(capability: string, session: string, claims: readonly Claim[], lists: ReadonlyMap<string, readonly string[]>): { holder: Claim; on?: string } | undefined {
  const others = claims.filter((claim) => claim.session !== session && claim.holder === "live");
  const direct = others.find((claim) => claim.capability === capability);
  if (direct !== undefined) return { holder: direct };
  if (claims.some((claim) => claim.capability === capability && claim.session === session)) return undefined;
  const listing = others.find((claim) => claim.increment !== undefined && (lists.get(claim.increment) ?? []).includes(capability));
  return listing === undefined ? undefined : { holder: listing, on: listing.increment! };
}

interface AllowedCapability {
  readonly capability: string;
  readonly covers: string[];
}

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

function covered(covers: readonly string[], file: string): boolean {
  return covers.some((cover) => cover === "." || file === cover || file.startsWith(`${cover}/`));
}

async function allowedNow(library: Library, increment: string): Promise<AllowedCapability[]> {
  const [listed, tree] = await Promise.all([listOf(library, increment), library.projectTree()]);
  const covers = new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id, covers: its }) => [id, its ?? []] as const)));
  return listed.map((capability) => ({ capability, covers: [...(covers.get(capability) ?? [])] }));
}

export async function recordPromptYes(context: GateContext, checkout: string, files: readonly EditedFile[], imports: readonly ImportedFolderPlace[], isCode?: ReadsCode): Promise<string | undefined> {
  const imported = files.filter((file) => imports.some(({ folder }) => isWithin(path.resolve(checkout, file.path), folder)));
  if (imported.length === 0) return undefined;
  const refusal = await refusalOf(context, checkout, imported, async () => new Map(), imports, false, undefined, isCode);
  if (refusal?.refused !== "ask") return undefined;
  await context.log.append(context.project, {
    session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: "hook", ...(context.folder === undefined ? {} : { folder: context.folder }),
    kind: "user-allowed", increment: refusal.increment, how: "prompt", capabilities: await allowedNow(context.library, refusal.increment),
  });
  return refusal.increment;
}

export async function unallowedImportEdits(context: GateContext, checkout: string, files: readonly EditedFile[], imports: readonly ImportedFolderPlace[], isCode?: ReadsCode): Promise<EditedFile[]> {
  const unallowed = async (some: readonly EditedFile[]) => (await refusalOf(context, checkout, some, async () => new Map(), imports, false, undefined, isCode)) !== undefined;
  if (!(await unallowed(files))) return [];
  const found: EditedFile[] = [];
  for (const file of files) if (await unallowed([file])) found.push(file);
  return found;
}

export async function shellEditRefusals(context: GateContext, checkout: string, files: readonly EditedFile[], declared: DeclaredCapabilities): Promise<EditRefusal[]> {
  return refusalsOf(context, checkout, files, declared, [], false, true);
}

export type AllowAnswer = { readonly ok: true; readonly capabilities: readonly AllowedCapability[] } | { readonly ok: false; readonly reason: string };

export async function allowIncrement(context: Pick<ClaimContext, "log" | "library" | "project" | "folder">, person: string, increment: string): Promise<AllowAnswer> {
  return recordYes(context, increment, { session: `person:${person}`, source: "tool", how: "command" });
}

export async function allowSaid(context: GateContext, increment: string): Promise<AllowAnswer> {
  return recordYes(context, increment, { session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: "hook", how: "said" });
}

async function recordYes(context: Pick<ClaimContext, "log" | "library" | "project" | "folder">, increment: string, by: { session: string; harness?: string; source: "tool" | "hook"; how: "command" | "said" }): Promise<AllowAnswer> {
  const record = await context.library.get(increment);
  if (record?.type !== "increment") return { ok: false, reason: `${increment} is not an increment of this project.` };
  const capabilities = await allowedNow(context.library, increment);
  if (capabilities.length === 0) return { ok: false, reason: `${increment} lists no capabilities yet, so a yes would allow nothing: the agent lists the explored capability it means to change first.` };
  await context.log.append(context.project, { ...by, ...(context.folder === undefined ? {} : { folder: context.folder }), kind: "user-allowed", increment, capabilities });
  return { ok: true, capabilities };
}

function isWithin(file: string, folder: string): boolean {
  const relative = path.relative(path.resolve(folder), file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function coveringOf(tree: AnnotatedTree, imported: ImportedFolderPlace, file: string): { capability: string; title: string } | undefined {
  for (const story of tree.stories) {
    const from = story.mapped?.from;
    if (from === undefined || (from !== imported.repository && path.resolve(from) !== path.resolve(imported.folder))) continue;
    const found = story.capabilities.find(({ covers }) => covered(covers ?? [], file));
    if (found !== undefined) return { capability: found.id, title: found.title };
  }
  return undefined;
}

async function drawnOf(tree: AnnotatedTree, imported: ImportedFolderPlace, file: string, readsCode: ReadsCode): Promise<"on-disk" | "new" | "unread" | undefined> {
  if (await readsCode(file)) return existsSync(path.join(imported.folder, file)) ? "on-disk" : "new";
  const holding = mappedFrom(tree, imported).filter(({ mapped }) => mapped!.folders.some((folder) => folder === "." || covered([folder], file)));
  const covers = [...new Set(holding.flatMap((story) => story.capabilities.flatMap((capability) => capability.covers ?? [])))];
  for (const cover of covers) {
    const entries = await readdir(path.join(imported.folder, cover), { withFileTypes: true }).catch(() => undefined);
    const files = entries === undefined ? [cover] : entries.filter((entry) => entry.isFile()).map((entry) => `${cover}/${entry.name}`);
    for (const one of files) if (await readsCode(one)) return "unread";
  }
  return undefined;
}

function mappedFrom(tree: AnnotatedTree, imported: ImportedFolderPlace): AnnotatedStory[] {
  return tree.stories.filter(({ mapped: on }) => on?.from !== undefined && (on.from === imported.repository || path.resolve(on.from) === path.resolve(imported.folder)));
}

function listedOf(tree: AnnotatedTree, imported: ImportedFolderPlace, capabilities: readonly string[]): ListedCover[] {
  const found = new Map(mappedFrom(tree, imported).flatMap((story) => story.capabilities.map(({ id, title, covers }) => [id, { capability: id, title, covers: [...(covers ?? [])] }] as const)));
  return capabilities.flatMap((capability) => found.get(capability) ?? []);
}

export function refusalMessage(refusal: EditRefusal, after = false): string {
  const said = refusalReason(refusal, after);
  return refusal.lapsed === undefined ? said : said.replace(/^\[storytree\] /, () => `[storytree] ${lapseMessage(refusal.lapsed!)} `);
}

function refusalReason(refusal: EditRefusal, after: boolean): string {
  if (refusal.refused === "imported") {
    const where = `${refusal.file} in ${refusal.folder}, code the project imports`;
    if (refusal.drawn !== undefined) return drawnRefusal(refusal, where);
    if (refusal.listed !== undefined && refusal.listed.length > 0) {
      const named = refusal.listed.map(({ capability, title, covers }) => `"${title}" (${capability}), covering ${covers.join(", ")}`).join("; ");
      const ids = refusal.listed.map(({ capability }) => capability).join(" or ");
      return `[storytree] Your edit to ${where}, was refused before it happened: imported code is changed only when your increment names the explored capability covering it (ADR-0993 D4, ADR-1015), and no capability covers this file yet, though your increment ${refusal.increment} lists ${named}. If it is part of what you are changing, add ${refusal.file} to the covers of one of them (edit_plan with id ${ids}, covers its covers now plus ${refusal.file}, and live: true, so the gate sees it before your branch merges), then edit again; or ask the user what to do.`;
    }
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

function drawnRefusal(refusal: Extract<EditRefusal, { refused: "imported" }>, where: string): string {
  const lead = `[storytree] Your edit to ${where}, was refused before it happened: imported code is changed only when your increment names the explored capability covering it (ADR-0993 D4, ADR-1015), and no capability covers this file yet. Storytree draws this code's capabilities from its imports (ADR-1324), so none is drawn or widened by hand:`;
  const reimport = `import the folder again (import_project with folder ${refusal.folder})`;
  const listing = refusal.increment === undefined ? "list it on an increment you hold (park_increment and make_workspace)" : `list the capability that holds it on your increment ${refusal.increment} (edit_plan)`;
  if (refusal.drawn === "unread") return `${lead} the map does not read ${refusal.file}'s language, so no drawing takes it in. Make the change in a file a capability covers${suchOf(refusal)}; or ask the user what to do.`;
  if (refusal.drawn === "on-disk") return `${lead} ${reimport} so the drawing takes ${refusal.file} in, then ${listing}, then edit again; or ask the user what to do.`;
  return `${lead} the drawing takes a file in only once it is written. Make the change in a file a capability covers${suchOf(refusal)}; or ask the user to make ${refusal.file}, then ${reimport} so the drawing takes it in, ${listing}, and edit again.`;
}

function suchOf(refusal: Extract<EditRefusal, { refused: "imported" }>): string {
  return refusal.listed === undefined || refusal.listed.length === 0 ? " (show_plan lists them)" : `, such as ${refusal.listed.map(({ capability, title, covers }) => `"${title}" (${capability}), covering ${covers.join(", ")}`).join("; ")}`;
}

export function allowCommand(increment: string): string {
  return `storytree workspace allow ${increment}`;
}

async function declaredOwners(tree: AnnotatedTree, moves: readonly PendingChange[], files: readonly (EditedFile & { root: string; relative: string })[], declared: DeclaredCapabilities): Promise<{ capability: string; title: string; file: string }[]> {
  const moved = movedOnly(tree, moves);
  const titles = new Map([...tree.stories, ...(moved?.stories ?? [])].flatMap((story) => story.capabilities.map(({ id, title }) => [id, title] as const)));
  const owners: { capability: string; title: string; file: string }[] = [];
  for (const root of new Set(files.map((file) => file.root))) {
    const texts = new Map(files.filter((file) => file.root === root).map((file) => [file.relative, file.text] as const));
    const readText = (file: string) => texts.get(file) ?? readFileSync(path.join(root, file), "utf8");
    const first = moved === undefined ? new Map<string, string>() : await declared(root, [...texts.keys()], moved, readText);
    const rest = [...texts.keys()].filter((file) => !first.has(file));
    const placed = new Map([...first, ...(rest.length === 0 ? [] : await declared(root, rest, tree, readText))]);
    for (const file of texts.keys()) {
      const capability = placed.get(file);
      if (capability === undefined) continue;
      if (!owners.some((owner) => owner.capability === capability)) owners.push({ capability, title: titles.get(capability)!, file });
    }
  }
  return owners;
}

function factoryCheckoutOf(file: string, factory: string): string | undefined {
  let root = path.dirname(file);
  while (!existsSync(path.join(root, ".git"))) {
    if (path.dirname(root) === root) return undefined;
    root = path.dirname(root);
  }
  const home = realOf(factory);
  const dotGit = path.join(root, ".git");
  if (statSync(dotGit).isDirectory()) return realOf(root) === home ? root : undefined;
  const pointed = /^gitdir:(.*)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
  return pointed !== undefined && isWithin(realOf(path.resolve(root, pointed)), path.join(home, ".git", "worktrees")) ? root : undefined;
}

function realOf(folder: string): string {
  try {
    return realpathSync.native(folder);
  } catch {
    return path.resolve(folder);
  }
}

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

async function planOf(library: Library, increment: string): Promise<{ capabilities: readonly string[]; pending: readonly PendingChange[] }> {
  const record = await library.get(increment);
  const fields = record?.type === "increment" ? (record as SchemaRecord<"increment">).fields : undefined;
  return { capabilities: fields?.capabilities ?? [], pending: fields?.pending ?? [] };
}

export async function listOf(library: Library, increment: string): Promise<readonly string[]> {
  return (await planOf(library, increment)).capabilities;
}
