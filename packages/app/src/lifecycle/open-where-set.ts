// Capability 1 · Lifecycle
import { readLibrary } from "@storytree/project-and-caller";
import type { ConnectOptions, Storytree } from "@storytree/library";

export interface StartedPostgres {
  readonly url: string;
  stop(): Promise<void>;
}

export interface AppLibraryOptions<P extends StartedPostgres = StartedPostgres> {
  readonly home: string;
  readonly startLocal: () => Promise<P>;
  readonly connect: (options: ConnectOptions) => Promise<Storytree>;
}

export interface AppLibrary<P extends StartedPostgres = StartedPostgres> {
  readonly storytree: Storytree;
  readonly postgres: P | undefined;
  readonly where: string;
}

export async function openAppLibrary<P extends StartedPostgres>(options: AppLibraryOptions<P>): Promise<AppLibrary<P>> {
  const setting = readLibrary(options.home);
  if (setting.location === "postgres") {
    const { address } = setting;
    try {
      return { storytree: await options.connect({ address }), postgres: undefined, where: `the Postgres at ${address}` };
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error);
      throw new Error(
        `The library is set to the Postgres at ${address}, and it could not be reached: ${said} ` +
          "(To use this computer's own library instead, run `storytree settings set library local` and open the app again.)",
        { cause: error },
      );
    }
  }
  const postgres = await options.startLocal();
  try {
    return { storytree: await options.connect({ url: postgres.url }), postgres, where: withoutPassword(postgres.url) };
  } catch (error) {
    await postgres.stop().catch(() => {});
    throw error;
  }
}

function withoutPassword(url: string): string {
  const shown = new URL(url);
  shown.password = "";
  return shown.href;
}

export function libraryProblem(error: unknown): string {
  if (error instanceof Error && error.name === "DataDirInUseError") {
    const { dataDir, owner, pid } = error as Error & { dataDir: string; owner?: string; pid: number };
    return `The app's library (${dataDir}) is in use by ${owner ?? "another program"} (process ${pid}). Close that, then open the app again.`;
  }
  return `The app's library could not be opened: ${error instanceof Error ? error.message : String(error)}`;
}
