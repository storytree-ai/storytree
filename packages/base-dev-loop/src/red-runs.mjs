// Capability 4 · Running the tests
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export function recordReds(root, { tests = [], unloaded = [] }) {
  const failed = [...tests.filter((test) => test.result === "fail").map(({ file, name }) => ({ file, test: name })), ...unloaded.map((file) => ({ file, test: null }))];
  if (failed.length === 0) return;
  const at = new Date().toISOString();
  const git = (...args) => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    } catch {
      return "";
    }
  };
  const head = git("rev-parse", "HEAD");
  const lines = failed.map((row) => `${JSON.stringify({ at, head, ...row })}\n`).join("");
  const common = head === "" ? "" : git("rev-parse", "--path-format=absolute", "--git-common-dir");
  for (const file of [path.join(root, ".pgtest", "red-runs.jsonl"), ...(common === "" ? [] : [path.join(common, "storytree", "red-runs.jsonl")])]) {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, lines);
  }
}
