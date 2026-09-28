/**
 * Capability 1 · Lifecycle, contracts 1.9 and 1.10 (ADR-0734 D1, ADR-0735 D4): the app opens its
 * library where the user's library setting says. Local (the default), it starts its own Postgres on
 * its data folder and connects there, as it always has. Set to a Cloud SQL instance, it starts no
 * Postgres at all and connects to the instance; when the instance cannot be reached it says so in
 * the refusal's own words, and never opens the local library instead, which would split one board
 * in two.
 */
import { readSettings } from "@storytree/agent-link";
import type { ConnectOptions, Storytree } from "@storytree/library";

/** The app's own Postgres, as local-postgres hands it back: where it listens, and how to stop it. */
export interface StartedPostgres {
  readonly url: string;
  stop(): Promise<void>;
}

export interface AppLibraryOptions<P extends StartedPostgres = StartedPostgres> {
  /** The storytree home, whose settings.json says where the library lives. */
  readonly home: string;
  /** Start the app's own Postgres; called only when the library is local. */
  readonly startLocal: () => Promise<P>;
  /** The library's connect(). */
  readonly connect: (options: ConnectOptions) => Promise<Storytree>;
}

export interface AppLibrary<P extends StartedPostgres = StartedPostgres> {
  readonly storytree: Storytree;
  /** The app's own Postgres, when the library is local; undefined on Cloud SQL. */
  readonly postgres: P | undefined;
  /** Where the library is, for the app's log. */
  readonly where: string;
}

/** Open the library where the settings say, starting the app's own Postgres only when it is local. */
export async function openAppLibrary<P extends StartedPostgres>(options: AppLibraryOptions<P>): Promise<AppLibrary<P>> {
  const setting = readSettings(options.home).library;
  if (setting.location === "cloudsql") {
    const { instance, user } = setting;
    try {
      return { storytree: await options.connect({ cloudSql: { instance, user } }), postgres: undefined, where: `Cloud SQL ${instance} as ${user}` };
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error);
      throw new Error(
        `The library is set to the Cloud SQL instance ${instance}, and it could not be reached: ${said} ` +
          "(To use this computer's own library instead, run `storytree settings set library local` and open the app again.)",
        { cause: error },
      );
    }
  }
  const postgres = await options.startLocal();
  try {
    return { storytree: await options.connect({ url: postgres.url }), postgres, where: postgres.url };
  } catch (error) {
    await postgres.stop().catch(() => {});
    throw error;
  }
}
