/**
 * Capability 4 · Updates. Contract 4.18 at desktop start: one storytree desktop app per machine (ADR-0940 D1). The app that
 * follows merged main (it runs from a runtime slot) refuses where the installed app is, and the
 * installed app refuses where the follow-main app is set up; a start from a development checkout is
 * neither, and checks nothing. @storytree/app's otherApp words the refusal; nothing here removes
 * either copy.
 */
import { otherApp } from "@storytree/app";

export interface StartingApp {
  /** The runtime slot this app runs from, when it is the app that follows merged main. */
  slot: string | undefined;
  /** Whether this is the installed (one-click) app. */
  installed: boolean;
  /** The app's home: ~/.storytree/0.3, or STORYTREE_HOME. */
  home: string;
  /** Where Windows keeps a user's apps (%LOCALAPPDATA%). By default, LOCALAPPDATA. */
  localAppData?: string | undefined;
}

/** Why this app may not start beside the other copy, naming it; undefined when it may. */
export function startRefusal({ slot, installed, home, localAppData }: StartingApp): string | undefined {
  const starting = slot !== undefined ? "follow-main" : installed ? "installed" : undefined;
  return starting === undefined ? undefined : otherApp({ starting, home, localAppData });
}
