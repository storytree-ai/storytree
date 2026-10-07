/**
 * Capability 2 · Library transactions. The name (Postgres's application_name) of the connection a seed holds while it writes a library:
 * a library script that writes (`pnpm check:own-health`, `pnpm library:restore`) holds its writing
 * lock on a connection of this name, and the app's updater looks for it before restarting.
 */
export const SEED_CONNECTION = "storytree-seed";
