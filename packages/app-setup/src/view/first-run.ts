// Capability 3 · First-run guide.
const SEEN = "storytree:setup:guide-seen:v1";

export type GuideMemory = () => Pick<Storage, "getItem" | "setItem">;

export function guideOffered(storage: GuideMemory): boolean {
  try { return storage().getItem(SEEN) !== "yes"; } catch { return true; }
}

export function rememberGuideDismissed(storage: GuideMemory): void {
  try { storage().setItem(SEEN, "yes"); } catch {}
}
