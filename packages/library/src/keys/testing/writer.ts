/** A separate process saving keys, for the test that two writers at once lose nothing. */
import { saveKey } from "../index.js";

const [home, prefix, count] = process.argv.slice(2) as [string, string, string];
for (let i = 0; i < Number(count); i++) saveKey(`${prefix}-${i}`, `value-${prefix}-${i}`, { home });
