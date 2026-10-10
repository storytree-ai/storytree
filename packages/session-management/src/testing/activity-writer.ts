/**
 * A second process that writes to the agent activity log, for activity-log.test.ts (contract 2.1):
 * `activity-writer.ts <url> <project> <session> <count>` appends `count` lines for `session`, each a
 * command `step <n>` numbered from 1, as fast as it can, then exits 0.
 */
import { openActivityLog } from "../activity/index.js";

const [url, project, session, count] = process.argv.slice(2);
if (url === undefined || project === undefined || session === undefined || count === undefined) {
  throw new Error("usage: activity-writer.ts <url> <project> <session> <count>");
}
const log = await openActivityLog(url);
try {
  for (let step = 1; step <= Number(count); step++) {
    await log.append(project, { session, harness: "claude-code", source: "hook", kind: "command-run", command: `step ${step}` });
  }
} finally {
  await log.close();
}
