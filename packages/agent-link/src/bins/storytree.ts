/**
 * `storytree`: the command the setup check puts on the user's path (ADR-0643 D1, 8). The command
 * line for people is a story of its own (`0-3-cli-story-tree`, ADR-0643 D5), which will fill this
 * front door with its verbs. Until it does, the door answers `storytree setup install | remove`,
 * the agent link's own, and says so for anything else.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [verb, ...rest] = process.argv.slice(2);

if (verb === "setup") {
  const setup = fileURLToPath(new URL("./storytree-setup.mjs", import.meta.url));
  const ran = spawnSync(process.execPath, [setup, ...rest], { stdio: "inherit" });
  process.exit(ran.status ?? 1);
}

console.error(
  [
    "usage: storytree setup install | remove",
    "",
    "storytree 0.3's command line for people is being built as a story of its own; until it lands,",
    "`storytree setup` is the one verb here. Your agent reaches everything else through storytree's tools.",
  ].join("\n"),
);
process.exit(verb === undefined ? 0 : 2);
