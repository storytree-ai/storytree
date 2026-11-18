// Capability 5 · Claims
import type { Claim, ClaimContext } from "./claims.js";
import { readClaims } from "./claims.js";
import { holderOf, listOf } from "./edit-gate.js";

export interface PlacedFile {
  readonly file: string;
  readonly path: string;
  readonly story?: { readonly id: string; readonly title: string };
  readonly package?: string;
  readonly capability?: string;
  readonly inferred?: boolean;
}

export interface FileOwner extends PlacedFile {
  readonly title?: string;
  readonly holder?: Claim;
  readonly on?: string;
  readonly yours?: true;
}

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
