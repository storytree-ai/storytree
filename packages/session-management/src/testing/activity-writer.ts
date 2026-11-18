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
