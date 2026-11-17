// TEMPORARY probe for increment_4fd4bcacb977 (draft PR only, never landed): runs stable-candidate.test.ts many times
// on CI's Windows runner, each with git tracing to a file, and on a hang prints the trace and the processes left.
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const file = fileURLToPath(new URL("./stable-candidate.test.ts", import.meta.url));
const RUNS = Number(process.env.STRESS_RUNS ?? 60);
const AT_ONCE = 4;

function once(i: number): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), `stress-${i}-`));
  const trace = join(dir, "git-trace.txt");
  const started = Date.now();
  return new Promise(resolve => {
    const child = execFile(process.execPath, ["--import", "tsx", "--test", "--test-force-exit", "--test-reporter=spec", file], {
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, STORYTREE_TEST_RUNNING: undefined, GIT_TRACE: trace, GIT_TRACE2_PERF: join(dir, "perf.txt") },
      timeout: 60_000, encoding: "utf8", killSignal: "SIGKILL",
    }, (error, stdout, stderr) => {
      const ms = Date.now() - started;
      if (!error && ms < 30_000) return resolve(undefined);
      let procs = "";
      try { procs = process.platform === "win32" ? execFileSync("tasklist", { encoding: "utf8" }) : execFileSync("ps", ["-ef"], { encoding: "utf8" }); } catch {}
      const tail = (p: string) => existsSync(p) ? readFileSync(p, "utf8").split("\n").slice(-60).join("\n") : "(none)";
      resolve(`run ${i}: ${error ? `failed (${error.message.split("\n")[0]}, killed ${child.killed})` : "slow"} after ${ms} ms\n--- stdout\n${stdout}\n--- stderr\n${stderr}\n--- git trace tail\n${tail(trace)}\n--- trace2 perf tail\n${tail(join(dir, "perf.txt"))}\n--- processes\n${procs.split("\n").filter(l => /git|node|sh\.exe|bash|ssh|upload|pack/i.test(l)).join("\n")}`);
    });
  });
}

test("4.23 probe: stable-candidate.test.ts exits every time it is run", { timeout: 340_000 }, async () => {
  const problems: string[] = [];
  let next = 0;
  const lanes = Array.from({ length: AT_ONCE }, async () => {
    while (next < RUNS) {
      const problem = await once(next++);
      if (problem) { problems.push(problem); console.log(problem); }
    }
  });
  await Promise.all(lanes);
  console.log(`probe: ${RUNS} runs, ${problems.length} hung, failed or slow`);
  if (problems.length > 0) throw new Error(problems.join("\n\n=====\n\n"));
});
