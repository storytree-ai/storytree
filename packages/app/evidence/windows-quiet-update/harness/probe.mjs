// Contract 4.4's Windows run (increment_341abe802574): read what the installed app's quiet-moment check
// reads, from the app's own library in the run's throwaway home, and optionally write an agent line there.
//
//   node --import tsx probe.mjs <home>                         print {at, agentActiveAt, seedWriting}
//   node --import tsx probe.mjs <home> agent <session> [kind]  append one agent line (default kind command-run), then print
//
// The agent line goes through the activity log's own writer (openActivityLog().append), as an agent's
// hook writes one; agentActiveAt and seedWriting are the functions the desktop's quietMoment and
// canRestart call. The home's library is local (no settings.json), so its Postgres is the app's own.
import path from "node:path";

import { connect } from "@storytree/library";
import { locateStorytree } from "@storytree/project-and-caller";
import { openActivityLog } from "@storytree/session-management";

import { agentActiveAt } from "../../../src/updates/agent-activity.ts";
import { seedWriting } from "../../../src/updates/seed-writing.ts";

const [home, verb, session, kind = "command-run"] = process.argv.slice(2);
if (home === undefined) throw new Error("usage: probe.mjs <home> [agent <session> [kind]]");

const found = locateStorytree({ dataDir: path.join(home, "pgdata") });
if (!found.running) {
  console.log(JSON.stringify({ at: new Date().toISOString(), running: false, message: found.message }));
  process.exit(0);
}
const storytree = await connect({ url: found.url });
try {
  if (verb === "agent") {
    const log = await openActivityLog(storytree, { machine: "laptop-acceptance" });
    await log.append("acceptance-4-4", { session, harness: "claude-code", source: "hook", kind, folder: home, ...(kind === "command-run" ? { command: "acceptance 4.4: an agent at work" } : {}) });
  }
  const active = await agentActiveAt(storytree);
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    agentActiveAt: active === undefined ? null : new Date(active).toISOString(),
    seedWriting: await seedWriting(found.url),
    ...(verb === "agent" ? { wrote: { session, kind } } : {}),
  }));
} finally {
  await storytree.close();
}
