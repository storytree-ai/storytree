import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const cwd = path.join(root, "packages", "app");
const file = path.join(cwd, "src", "updates", "stable-candidate.test.ts");
const lanes = Number(process.env.PROBE_LANES ?? 8);
const until = Date.now() + Number(process.env.PROBE_MINUTES ?? 90) * 60_000;
const out = process.env.PROBE_OUT ?? path.join(root, "probe-out");
const HANG_MS = 90_000;
mkdirSync(out, { recursive: true });

const ps = (script) => execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 64 << 20 });

function snapshot(runnerPid) {
  const all = JSON.parse(ps("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine,KernelModeTime,UserModeTime | ConvertTo-Json -Depth 3"));
  const kids = new Map();
  for (const p of all) kids.set(p.ParentProcessId, [...(kids.get(p.ParentProcessId) ?? []), p]);
  const tree = [];
  const walk = (pid, depth) => {
    for (const p of kids.get(pid) ?? []) {
      tree.push({ depth, ...p });
      walk(p.ProcessId, depth + 1);
    }
  };
  tree.push({ depth: 0, ...all.find((p) => p.ProcessId === runnerPid) });
  walk(runnerPid, 1);
  const threads = {};
  for (const p of tree) {
    if (!p.ProcessId) continue;
    try {
      threads[p.ProcessId] = JSON.parse(ps(`(Get-Process -Id ${p.ProcessId}).Threads | Select-Object Id,ThreadState,WaitReason,TotalProcessorTime | ConvertTo-Json -Depth 2`));
    } catch (error) {
      threads[p.ProcessId] = String(error.message).slice(0, 200);
    }
  }
  const strays = all.filter((p) => /git|ssh|sh\.exe|bash|esbuild|conhost/i.test(p.Name ?? ""));
  return { tree, threads, strays };
}

let runs = 0;
const latencies = [];
const totals = [];
const problems = [];

function once(n) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-force-exit", "--test-reporter=spec", "--test-reporter-destination=stdout", file], {
      cwd,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, STORYTREE_TEST_RUNNING: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = [];
    let lastPass = undefined;
    const take = (stream) => (chunk) => {
      const at = Date.now() - started;
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        lines.push(`${at}ms ${stream} ${line}`);
        if (/^\s*[✔✖]/.test(line)) lastPass = at;
      }
    };
    child.stdout.on("data", take("out"));
    child.stderr.on("data", take("err"));
    let hung;
    const watch = setTimeout(() => {
      try {
        hung = snapshot(child.pid);
      } catch (error) {
        hung = { error: String(error.stack) };
      }
      try { execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }); } catch {}
    }, HANG_MS);
    child.on("close", (code) => {
      clearTimeout(watch);
      const ms = Date.now() - started;
      totals.push(ms);
      const passes = lines.filter((l) => / out\s+✔/.test(l)).length;
      if (lastPass !== undefined) latencies.push(ms - lastPass);
      if (hung || code !== 0 || passes !== 10) {
        const record = { run: n, code, ms, lastPass, passes, lines, hung };
        problems.push(record);
        writeFileSync(path.join(out, `problem-${n}.json`), JSON.stringify(record, null, 2));
        console.log(`PROBLEM run ${n}: code ${code}, ${ms} ms, ${passes} passed, last test at ${lastPass} ms, hung ${Boolean(hung)}`);
      }
      resolve();
    });
  });
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : undefined;
};
const summary = () => ({
  lanes, runs, problems: problems.length,
  exitAfterLastTest: { p50: pct(latencies, 50), p90: pct(latencies, 90), p99: pct(latencies, 99), max: Math.max(...latencies), over5s: latencies.filter((x) => x > 5000).length, over10s: latencies.filter((x) => x > 10000).length, over20s: latencies.filter((x) => x > 20000).length },
  total: { p50: pct(totals, 50), p99: pct(totals, 99), max: Math.max(...totals) },
});

const report = setInterval(() => console.log(JSON.stringify(summary())), 120_000);
await Promise.all(Array.from({ length: lanes }, async () => {
  while (Date.now() < until) await once(runs++);
}));
clearInterval(report);
const final = summary();
writeFileSync(path.join(out, "summary.json"), JSON.stringify({ ...final, latencies, totals }, null, 2));
console.log(JSON.stringify(final, null, 2));
if (problems.length > 0) process.exitCode = 1;
