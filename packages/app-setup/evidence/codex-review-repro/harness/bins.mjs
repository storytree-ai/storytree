import { buildBins } from "/home/mickh/code/storytree03/packages/agent-link/src/bins/build.ts";
console.log(JSON.stringify(await buildBins(process.argv[2])));
