// The shop's proof (increment_02947bc9dab4): every push run on its main, read as CI health reads a user's CI.
// From the checkout root, on the Mint box, which holds the shop's archived runs, its mirror and its library record:
// node --import tsx packages/ci-health/evidence/shop/replay.ts [--ci <dir>] [--repository <shop git dir>] [--record <library record>] [--live]
// --live also reads the newest push run through the GitHub Actions API (`gh`), as `storytree health ci` does, writing
// its verdicts to a stand-in for the library instead of the shop's own, which lives on the test laptop.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Library } from "@storytree/library";
import { commitOfLog, ghApi, judgeRun, parseTestLog, proofsAt, readProjectCi, type PlanTree } from "../../src/index.js";

const lanes = path.join(homedir(), "storytree-lanes");
const { values } = parseArgs({ options: {
  ci: { type: "string", default: path.join(lanes, "shop-private/ci") },
  repository: { type: "string", default: path.join(lanes, "shop-grade/shop.git") },
  record: { type: "string", default: path.join(lanes, "shop-private/library-final.json") },
  live: { type: "boolean", default: false },
} });
const git = (args: string[]) => execFileSync("git", ["-C", values.repository!, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const tree: PlanTree = JSON.parse(readFileSync(values.record!, "utf8")).tree;
const contracts = tree.stories.flatMap((story) => story.capabilities.flatMap((capability) => capability.contracts)).length;

console.log(`run\tcommit\ttests\tunmatched\tpassing\tfailing\tnot checked (of ${contracts} contracts in the final plan)`);
const runs = readFileSync(path.join(values.ci!, "runs.tsv"), "utf8").trim().split("\n").map((line) => line.split("\t")).filter(([, event, branch]) => event === "push" && branch === "main").reverse();
for (const [run] of runs) {
  const log = readFileSync(path.join(values.ci!, `run-${run}.log`), "utf8");
  const commit = commitOfLog(log)!;
  const files = git(["ls-tree", "-r", "--name-only", commit, "--", "packages"]).split("\n").filter((file) => /^packages\/[^/]+\/src\/.+\.[cm]?[jt]sx?$/.test(file)).map((file) => ({ path: file, text: git(["show", `${commit}:${file}`]) }));
  const results = parseTestLog(log);
  const { verdicts, unmatched } = judgeRun(proofsAt(tree, files), results);
  const count = (state: string) => [...verdicts.values()].filter((verdict) => verdict.state === state).length;
  console.log([run, commit.slice(0, 7), results.length, unmatched.length, count("passing"), count("failing"), count("not-checked")].join("\t"));
}

if (values.live) {
  const written: string[] = [];
  const library = { projectTree: async () => tree, recordVerified: async (id: string, state: string) => { written.push(`${id} ${state}`); } } as unknown as Library;
  const read = await readProjectCi({ library, git: async (args) => (args[0] === "remote" ? "https://github.com/HuaMick/shop.git" : git(args)), github: ghApi() });
  console.log(read.written ? `live: ${read.run} at ${read.commit.slice(0, 7)}: ${read.tests} tests, ${read.passing} passing, ${read.failing} failing, ${read.notChecked} not checked, ${read.unmatched} unmatched; ${written.length} verdicts written` : `live: ${read.why}`);
}
