import { start } from "/home/mickh/code/storytree03/packages/local-postgres/src/index.ts";
const server = await start({ dataDir: "/tmp/cxrepro/home/pgdata", owner: "codex review repro", log: (m) => console.log(`pg: ${m}`) });
console.log(`READY ${server.url}`);
process.on("SIGTERM", async () => { await server.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
