// One run's cost, for the routine's log and the owner's question: the user's turns and the judge, in minutes, tokens
// and list-price dollars. Usage: node cost.mjs <evidence folder>
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const read = (f) => existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), "utf8")) : null;
const turns = ["turn-1.summary.json", "turn-2.summary.json"].map(read).filter(Boolean);
const judge = read("judge.json");
const tokens = turns.reduce((a, t) => a + (t.tokens?.total ?? 0), 0)
  + Object.values(judge?.usage ?? {}).reduce((a, n) => a + (typeof n === "number" ? n : 0), 0);
const dollars = turns.reduce((a, t) => a + (t.costUsd ?? 0), 0) + (judge?.total_cost_usd ?? 0);
const userMinutes = Math.round(turns.reduce((a, t) => a + (t.seconds ?? 0), 0) / 60);
console.log(`user turns ${userMinutes} minutes; ${tokens.toLocaleString("en")} tokens, $${dollars.toFixed(2)} at list price (user and judge)`);
