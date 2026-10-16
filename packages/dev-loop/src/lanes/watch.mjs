// Capability 13 · A watcher lands a handed-over pull request (ADR-0955 D3). Its code is the agent pool's package (packages/agent-pool/src/watch.mjs, ADR-1066 D3); this
// forwarder keeps the path the Mint box's live processes and older checkouts run working: node packages/dev-loop/src/lanes/watch.mjs …
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "@storytree/agent-pool/watch";

export { main };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
