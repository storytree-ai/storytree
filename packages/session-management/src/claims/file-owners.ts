/**
 * Capability 5 · Claims: the owners query. A session about to edit several files learns, before its first edit, each
 * file's capability and who holds it, by the edit gate's own rule (holderOf), so it can claim every free one in one
 * call (ADR-1079 D2) instead of finding them from the gate's refusals one by one. Where each file belongs is the
 * map's to say, which Session management may not import (ADR-0969): each door hands it as `placeFiles`.
 */
import type { Claim, ClaimContext } from "./claims.js";
import { readClaims } from "./claims.js";
import { holderOf, listOf } from "./edit-gate.js";

/** Where a file belongs, as the door's placement gives it: the door's own copy of the map's shape (ADR-1017 D2). */
export interface PlacedFile {
  readonly file: string;
  readonly path: string;
  readonly story?: { readonly id: string; readonly title: string };
  readonly package?: string;
  readonly capability?: string;
  readonly inferred?: boolean;
}

/** A placed file with its capability's title and its holder: another live session (`on` an increment's list), the caller, or nobody. */
export interface FileOwner extends PlacedFile {
  readonly title?: string;
  readonly holder?: Claim;
  readonly on?: string;
  readonly yours?: true;
}

/** Each of `placed` with its capability's title and holder, as the context's session would meet them at the edit gate. */
export async function fileOwners(context: Pick<ClaimContext, "log" | "library" | "project" | "session" | "quietMs" | "restarted">, placed: readonly PlacedFile[]): Promise<FileOwner[]> {
  const [tree, claims] = await Promise.all([
    context.library.projectTree(),
    readClaims(context.log, context.project, {
      ...(context.quietMs === undefined ? {} : { quietMs: context.quietMs }),
      ...(context.restarted === undefined ? {} : { restarted: context.restarted }),
    }),
  ]);
  const increments = [...new Set(claims.filter((claim) => claim.increment !== undefined && (claim.holder === "live" || claim.session === context.session)).map((claim) => claim.increment!))];
  const lists = new Map(await Promise.all(increments.map(async (increment) => [increment, await listOf(context.library, increment)] as const)));
  const titles = new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id, title }) => [id, title] as const)));
  const mine = (capability: string): boolean => claims.some((claim) => claim.session === context.session
    && (claim.capability === capability || (claim.increment !== undefined && (lists.get(claim.increment) ?? []).includes(capability))));
  return placed.map((file) => {
    if (file.capability === undefined) return file;
    const title = titles.get(file.capability);
    const held = holderOf(file.capability, context.session, claims, lists);
    return {
      ...file, ...(title === undefined ? {} : { title }),
      ...(held === undefined ? (mine(file.capability) ? { yours: true as const } : {}) : { holder: held.holder, ...(held.on === undefined ? {} : { on: held.on }) }),
    };
  });
}

/** One file's line: its capability and holder, or the story package that holds it, or that no story's package does. */
export function ownerLine(owner: FileOwner): string {
  if (owner.capability === undefined) {
    if (owner.story === undefined) return `${owner.file}: in no story's package, so no claim covers it.`;
    return `${owner.file}: no capability declares or is inferred for it; it is in ${owner.package}, story ${owner.story.title} [${owner.story.id}]: claim the capability of that story its change belongs to.`;
  }
  const named = `${owner.title ?? "a capability"} [${owner.capability}]${owner.inferred ? " (inferred)" : ""}`;
  if (owner.holder !== undefined) {
    const { label, session, reason } = owner.holder;
    return `${owner.file}: ${named}, held by ${label} session ${session} (${reason})${owner.on === undefined ? "" : `, on ${owner.on}'s capabilities list`}.`;
  }
  return `${owner.file}: ${named}, ${owner.yours ? "yours" : "free"}.`;
}
