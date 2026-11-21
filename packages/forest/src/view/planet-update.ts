// Capability 3 · Story node render
import type { ClaimTint, ForestScene, Island, PointerTint, SessionWisp } from "@storytree/forest";

export interface OnShow {
  scene: ForestScene;
  places: ReadonlyMap<string, number>;
}

export function nextScene(shown: OnShow, scene: ForestScene, places: ReadonlyMap<string, number>): ForestScene | undefined {
  const previous = new Map(shown.scene.islands.map(island => [island.story, island]));
  const islands = scene.islands.map(island => previous.get(island.story)?.key === island.key ? previous.get(island.story)! : island);
  const same = islands.length === shown.scene.islands.length && islands.every((island, index) => island === shown.scene.islands[index])
    && JSON.stringify(scene.links ?? []) === JSON.stringify(shown.scene.links ?? [])
    && JSON.stringify(scene.plumbing ?? []) === JSON.stringify(shown.scene.plumbing ?? [])
    && JSON.stringify([scene.edges ?? [], scene.contracts ?? []]) === JSON.stringify([shown.scene.edges ?? [], shown.scene.contracts ?? []])
    && JSON.stringify(scene.pins ?? []) === JSON.stringify(shown.scene.pins ?? [])
    && JSON.stringify(scene.stores ?? []) === JSON.stringify(shown.scene.stores ?? [])
    && JSON.stringify(scene.parts ?? []) === JSON.stringify(shown.scene.parts ?? [])
    && places.size === shown.places.size && [...places].every(([story, place]) => shown.places.get(story) === place);
  return same ? undefined : { ...scene, islands };
}

export function sameWisps(a: readonly SessionWisp[], b: readonly SessionWisp[]): boolean {
  return a.length === b.length && a.every((wisp, index) => {
    const other = b[index]!;
    return wisp.session === other.session && wisp.story === other.story && wisp.colour === other.colour
      && wisp.faded === other.faded && wisp.pointer?.capability === other.pointer?.capability && wisp.pointer?.question === other.pointer?.question
      && wisp.capabilities.length === other.capabilities.length && wisp.capabilities.every((c, i) => c === other.capabilities[i]);
  });
}

export function pointersOn(pointed: ReadonlyMap<string, PointerTint>, land: NonNullable<Island["land"]>): Map<string, PointerTint> {
  const here = new Set(land.territories.flatMap(({ capability }) => capability === undefined ? [] : [capability]));
  return new Map([
    ...[...here].flatMap((capability) => {
      const tint = pointed.get(capability);
      return tint === undefined || tint.gate !== undefined ? [] : [[capability, tint] as const];
    }),
    ...[...pointed].filter(([, tint]) => tint.gate?.every((capability) => here.has(capability)) === true),
  ]);
}

export function gatePosts(gates: readonly { readonly at: { x: number; z: number }; readonly between: readonly [string, string] }[]): Map<string, { x: number; z: number }> {
  const posts = new Map<string, { x: number; z: number }>();
  for (const { at, between } of gates) {
    const key = [...between].sort().join("|");
    if (!posts.has(key)) posts.set(key, at);
  }
  return posts;
}

export function claimsInside(claimed: ReadonlyMap<string, ClaimTint>, parts: readonly { readonly shares: readonly { readonly capability?: string }[] }[]): string {
  return JSON.stringify(parts.map(({ shares }) => shares.map(({ capability }) => capability === undefined ? undefined : claimed.get(capability))));
}

export function claimsOn(claimed: ReadonlyMap<string, ClaimTint>, land: NonNullable<Island["land"]>): string {
  return JSON.stringify(land.territories.map(({ capability }) => capability === undefined ? undefined : claimed.get(capability)));
}
