/** Capability 3 · First-run guide. */
const SEEN = "storytree:setup:guide-seen:v1";

/** Where the guide's dismissal is remembered: the renderer's localStorage, whose very reading may throw. */
export type GuideMemory = () => Pick<Storage, "getItem" | "setItem">;

/** The guide is offered at launch, project or none, until it has been dismissed once (3.1). */
export function guideOffered(storage: GuideMemory): boolean {
  try { return storage().getItem(SEEN) !== "yes"; } catch { return true; /* First launch offers the guide. */ }
}

/** Dismissing the guide is remembered; Help reopens it whatever this says. */
export function rememberGuideDismissed(storage: GuideMemory): void {
  try { storage().setItem(SEEN, "yes"); } catch { /* Help remains usable without preference storage. */ }
}
