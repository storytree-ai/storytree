// Capability 17 · The library's commands
import type { HeldClaim } from "../knowledge/notes/index.js";
import type { VerbContext } from "./kit/index.js";

const MAIN_LINE: readonly string[] = ["main", "master"];

export interface LibraryVerbContext extends VerbContext {
  claims(): Promise<readonly HeldClaim[]>;
  testedNumbers(capability: string): Promise<{ readonly tested: readonly string[]; readonly untested: readonly string[] }>;
  pluginInFactory?(plugin: string): Promise<boolean>;
  levelsBehind?(story: string, parent: string): Promise<string[]>;
}

export async function branchIncrement(context: LibraryVerbContext): Promise<string | undefined> {
  const claim = (await context.claims()).find(({ session, increment, branch }) => session === context.session && increment !== undefined && branch !== undefined && !MAIN_LINE.includes(branch));
  return claim?.increment;
}
