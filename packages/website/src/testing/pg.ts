/**
 * The website's test helper for the Postgres `pnpm test` provides (STORYTREE_TEST_PG_DATA is its
 * data directory): a throwaway storytree home made to look like that server's, restated from the
 * command line's test helper (packages/cli/src/testing/cli.ts), itself restated from the agent link's.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Make `dataDir` look like the test server's, as a fake storytree home's `pgdata` does: a copy of
 * its owner record at `<dataDir>.owner.json` and, when the server asks for a password, of its
 * private sign-in handoff at `<dataDir>.auth/connection.json` (ADR-0941), private as discovery
 * checks it. A passwordless server has no handoff: only the record is copied.
 */
export function placeTestServer(dataDir: string): void {
  const server = process.env.STORYTREE_TEST_PG_DATA;
  if (server === undefined || server === "") throw new Error("STORYTREE_TEST_PG_DATA is not set: run the tests via `pnpm test`, which starts the test Postgres through @storytree/local-postgres.");
  writeFileSync(`${dataDir}.owner.json`, readFileSync(`${server}.owner.json`));
  const handoff = path.join(`${server}.auth`, "connection.json");
  if (!existsSync(handoff)) return;
  const directory = `${dataDir}.auth`;
  const file = path.join(directory, "connection.json");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privatePath(directory, true);
  writeFileSync(file, readFileSync(handoff), { mode: 0o600 });
  privatePath(file, false);
}

/** Owned by this user and readable by it alone: 0700/0600 on POSIX, a protected access list granting only this user on Windows. */
function privatePath(file: string, directory: boolean): void {
  if (process.platform !== "win32") return chmodSync(file, directory ? 0o700 : 0o600);
  const run = (command: string, args: string[]) => {
    const ran = spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", command), args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, windowsHide: true });
    if (ran.error !== undefined || ran.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${ran.error?.message ?? ran.stderr}`);
    return ran.stdout;
  };
  // The numeric SID only, never localized account names.
  const sid = run("whoami.exe", ["/user", "/fo", "csv", "/nh"]).match(/,"(S-1-\d+(?:-\d+)+)"\s*$/)?.[1];
  if (sid === undefined) throw new Error("whoami did not return the current user's SID");
  run("icacls.exe", [file, "/setowner", `*${sid}`]);
  run("icacls.exe", [file, "/inheritance:r", "/grant:r", `*${sid}:F`]);
}
