// Capability 8 · Lag instruments. `pnpm lag:desktop`: what a user's clicks cost in the desktop app (ADR-0836), measured the same way by
// every re-measure (capability 8, Lag instruments). It launches a second copy of the built desktop app
// with a throwaway STORYTREE_HOME holding copies of the real home's settings.json, machine.json and
// project-choice.json, so it reads the same library while the running app is left alone, and records,
// over a scripted run (12 s idle, a hover sweep over the globe, a 5 x 5 grid of globe clicks, the story
// panel's rows, the sessions list and the forest/library toggle):
// - in the main process, each IPC handler's time and answer size, and event-loop lag over 20 ms;
// - in the page, Event Timing (input to paint), Long Animation Frames and a CPU profile.
// It writes result.json and renderer.cpuprofile to the out folder and prints a per-phase summary.
// A report to read at an increment boundary, never a gate (ADR-0623).
//
//   pnpm lag:desktop [--project <name>] [--out <dir>] [--home-from <dir>|none]
//   pnpm lag:desktop --analyze <dir>      reprint a run's summary
//
// APP_DIR is the desktop app to launch (default: this checkout's apps/desktop, built first with
// `pnpm --filter @storytree/desktop build`; on the laptop, an installed slot's apps/desktop), and
// ELECTRON_EXE the Electron to run it with (default: the one APP_DIR installed), and ELECTRON_ARGS switches
// to give it (on a machine with no display, `--ozone-platform=headless`). --home-from names the
// home to copy settings from (default: STORYTREE_HOME, else ~/.storytree/0.3); `none` starts the app
// on an empty home.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const SETTINGS = ["settings.json", "machine.json", "project-choice.json"];

function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

const log = (...parts) => console.log(new Date().toISOString().slice(11, 23), ...parts);

/** Launch the app, run the script, and write result.json and renderer.cpuprofile into `out`. */
async function measure({ appDir, exe, extraArgs, homeFrom, project, out }) {
  const { _electron } = await import("playwright-core");
  mkdirSync(out, { recursive: true });
  const home = mkdtempSync(path.join(tmpdir(), "lag-desktop-home-"));
  if (homeFrom !== "none") for (const file of SETTINGS) if (existsSync(path.join(homeFrom, file))) cpSync(path.join(homeFrom, file), path.join(home, file));
  log("home", home, homeFrom === "none" ? "(empty)" : `(settings from ${homeFrom})`);

  const began = Date.now();
  const app = await _electron.launch({ executablePath: exe, args: [...extraArgs, appDir, ...(project ? ["--project", project] : [])], env: { ...process.env, STORYTREE_HOME: home }, timeout: 180_000 });
  app.process().stdout.on("data", (data) => process.stdout.write(`[main] ${data}`));
  app.process().stderr.on("data", (data) => process.stdout.write(`[main!] ${data}`));
  try {
    const wrapped = await app.evaluate(({ ipcMain }) => {
      globalThis.__ipc = [];
      globalThis.__lag = [];
      const wrap = (channel, fn) => async (...args) => {
        const start = performance.now();
        try {
          const answer = await fn(...args);
          let size = 0;
          try {
            size = JSON.stringify(answer)?.length ?? 0;
          } catch {}
          globalThis.__ipc.push({ channel, at: Date.now(), ms: performance.now() - start, size });
          return answer;
        } catch (error) {
          globalThis.__ipc.push({ channel, at: Date.now(), ms: performance.now() - start, error: String(error?.message ?? error) });
          throw error;
        }
      };
      const handlers = ipcMain._invokeHandlers;
      if (handlers) for (const [channel, fn] of handlers) handlers.set(channel, wrap(channel, fn));
      const handle = ipcMain.handle.bind(ipcMain);
      ipcMain.handle = (channel, fn) => handle(channel, wrap(channel, fn));
      let last = performance.now();
      setInterval(() => {
        const now = performance.now();
        const lag = now - last - 50;
        if (lag > 20) globalThis.__lag.push({ at: Date.now(), lag });
        last = now;
      }, 50).unref();
      return handlers ? handlers.size : -1;
    });
    log("wrapped IPC handlers:", wrapped);

    const page = await app.firstWindow();
    log("window after", Date.now() - began, "ms");
    await page.waitForFunction(() => document.body?.dataset.state === "ready" || document.body?.dataset.state === "error", null, { timeout: 180_000, polling: 100 });
    const state = await page.evaluate(() => document.body.dataset.state);
    const readyMs = Date.now() - began;
    log("state", state, "after", readyMs, "ms");
    await page.waitForTimeout(3000);

    await page.evaluate(() => {
      window.__ev = [];
      window.__loaf = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__ev.push({ name: e.name, start: e.startTime, duration: e.duration, inputDelay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart, presentation: e.startTime + e.duration - e.processingEnd });
      }).observe({ type: "event", durationThreshold: 16, buffered: false });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__loaf.push({
            start: e.startTime, duration: e.duration, blocking: e.blockingDuration,
            render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
            styleLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
            scripts: e.scripts.map((s) => ({ fn: s.sourceFunctionName, src: (s.sourceURL || "").split("/").pop(), pos: s.sourceCharPosition, inv: s.invoker, type: s.invokerType, dur: s.duration })),
          });
        }
      }).observe({ type: "long-animation-frame", buffered: false });
    });
    const marks = [];
    const mark = async (label) => marks.push({ label, perf: await page.evaluate(() => performance.now()), wall: Date.now() });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });

    // 1. Idle: what the live reading costs with nobody touching the app.
    await mark("idle");
    await page.waitForTimeout(12_000);

    await cdp.send("Profiler.start");
    const canvas = await page.locator("canvas").first().boundingBox({ timeout: 2000 }).catch(() => null);
    const clicks = [];
    if (canvas) {
      const cx = canvas.x + canvas.width / 2;
      const cy = canvas.y + canvas.height / 2;
      const r = Math.min(canvas.width, canvas.height) * 0.35;
      // 2. A hover sweep across the globe: every move picks.
      await mark("hover");
      await page.mouse.move(cx - r, cy - r * 0.3);
      await page.mouse.move(cx + r, cy + r * 0.3, { steps: 80 });
      await page.mouse.move(cx - r * 0.2, cy + r, { steps: 80 });
      await page.waitForTimeout(500);

      // 3. A grid of clicks on the globe: what each selected and two frames after it.
      await mark("globe-clicks");
      for (let gy = -2; gy <= 2; gy++) {
        for (let gx = -2; gx <= 2; gx++) {
          await page.mouse.click(cx + gx * r * 0.42, cy + gy * r * 0.42);
          const answer = await page.evaluate(async () => {
            const t = performance.now();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return { selected: document.body.dataset.selected, panel: !document.querySelector(".story-panel")?.hidden, twoFramesMs: performance.now() - t };
          });
          clicks.push({ gx, gy, ...answer });
          await page.waitForTimeout(700);
        }
      }

      // 4. The story panel's rows, if a click opened a story, then its tree.
      await mark("panel-clicks");
      const chosen = clicks.filter((click) => click.selected).at(-1);
      if (chosen === undefined) log("no story selected by the grid: the panel phase did not run");
      else {
        await page.mouse.click(cx + chosen.gx * r * 0.42, cy + chosen.gy * r * 0.42);
        await page.waitForTimeout(800);
        for (const row of (await page.locator(".story-panel summary").all()).slice(0, 8)) {
          await row.click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(400);
        }
        const tree = page.locator("[data-open-tree]");
        if (await tree.count()) {
          await tree.first().click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(1000);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }
      }
    } else log("no globe canvas: the hover, click and panel phases did not run");

    // 5. The sessions list's rows and the forest/library toggle.
    await mark("sessions-and-toggle");
    for (const row of (await page.locator(".sessions-list button, .sessions-list [role=button], .sessions-list li").all()).slice(0, 6)) {
      await row.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
    for (const mode of ["library", "forest", "library", "forest"]) {
      await page.locator(`[data-forest-mode=${mode}]`).click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    await mark("end");
    const { profile } = await cdp.send("Profiler.stop");
    writeFileSync(path.join(out, "renderer.cpuprofile"), JSON.stringify(profile));

    const ev = await page.evaluate(() => window.__ev);
    const loaf = await page.evaluate(() => window.__loaf);
    const ipc = await app.evaluate(() => globalThis.__ipc);
    const lag = await app.evaluate(() => globalThis.__lag);
    const mem = await page.evaluate(() => ({ heap: performance.memory?.usedJSHeapSize, nodes: document.getElementsByTagName("*").length }));
    writeFileSync(path.join(out, "result.json"), JSON.stringify({ state, readyMs, marks, clicks, ev, loaf, ipc, lag, mem, canvas }, null, 1));
    log("wrote", path.join(out, "result.json"));
  } finally {
    await app.close().catch(() => {});
  }
}

/** The summary of the run in `out`: IPC by channel, each phase's cost, events, clicks, long frames, main-process lag and the profile's top functions. */
export function summary(out) {
  const r = JSON.parse(readFileSync(path.join(out, "result.json"), "utf8"));
  const lines = [];
  const say = (...parts) => lines.push(parts.join(" "));
  const q = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;
  };
  const f = (n) => n.toFixed(0).padStart(6);
  say(`state ${r.state} after ${r.readyMs} ms`);
  say("marks", r.marks.map((m) => `${m.label}@${new Date(m.wall).toISOString().slice(14, 23)}`).join("  "));
  const t0 = r.ipc[0]?.at;
  const t1 = r.ipc.at(-1)?.at;
  say(`\nIPC: ${r.ipc.length} calls over ${(((t1 ?? 0) - (t0 ?? 0)) / 1000).toFixed(0)} s`);
  const by = {};
  for (const call of r.ipc) (by[call.channel] ??= []).push(call);
  say("channel".padEnd(34), "  n   p50   p90   max  avgKB  errs");
  for (const [channel, calls] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
    const ms = calls.map((c) => c.ms);
    say(channel.padEnd(34), String(calls.length).padStart(3), f(q(ms, 0.5)), f(q(ms, 0.9)), f(Math.max(...ms)), (calls.reduce((s, c) => s + (c.size ?? 0), 0) / calls.length / 1024).toFixed(1).padStart(6), String(calls.filter((c) => c.error).length).padStart(5));
  }
  for (let i = 0; i < r.marks.length - 1; i++) {
    const [a, b] = [r.marks[i].wall, r.marks[i + 1].wall];
    const [pa, pb] = [r.marks[i].perf, r.marks[i + 1].perf];
    const calls = r.ipc.filter((c) => c.at >= a && c.at < b);
    const counts = {};
    for (const c of calls) counts[c.channel.replace("storytree:", "")] = (counts[c.channel.replace("storytree:", "")] ?? 0) + 1;
    const ev = r.ev.filter((e) => e.start >= pa && e.start < pb);
    const lf = r.loaf.filter((e) => e.start >= pa && e.start < pb);
    const lg = r.lag.filter((e) => e.at >= a && e.at < b);
    const blocked = lf.reduce((s, e) => s + e.duration, 0);
    say(`\n[${r.marks[i].label}] ${((b - a) / 1000).toFixed(1)} s: ${calls.length} IPC ->`, JSON.stringify(counts));
    say(`   blocked ${((100 * blocked) / (pb - pa)).toFixed(1)}%  long frames ${lf.length}, longest ${f(Math.max(0, ...lf.map((e) => e.duration)))} ms  events>=16ms ${ev.length}, longest ${f(Math.max(0, ...ev.map((e) => e.duration)))} ms  main lag>20ms ${lg.length}, worst ${f(Math.max(0, ...lg.map((e) => e.lag)))} ms`);
  }
  say("\nEvent timing by name (>=16 ms):");
  const named = {};
  for (const e of r.ev) (named[e.name] ??= []).push(e);
  for (const [name, es] of Object.entries(named)) say(name.padEnd(14), es.length, "p50", f(q(es.map((e) => e.duration), 0.5)), "max", f(Math.max(...es.map((e) => e.duration))), " delay p50", f(q(es.map((e) => e.inputDelay), 0.5)), "processing p50", f(q(es.map((e) => e.processing), 0.5)), "presentation p50", f(q(es.map((e) => e.presentation), 0.5)));
  say(`\nClicks: ${r.clicks.length}, ${r.clicks.filter((c) => c.selected).length} selected a story`);
  say("\nTop long-frame script attributions (total ms):");
  const scripts = {};
  for (const l of r.loaf) for (const s of l.scripts) scripts[`${s.type}:${s.inv} ${s.fn}@${s.src}:${s.pos}`] = (scripts[`${s.type}:${s.inv} ${s.fn}@${s.src}:${s.pos}`] ?? 0) + s.dur;
  for (const [k, v] of Object.entries(scripts).sort((a, b) => b[1] - a[1]).slice(0, 15)) say(f(v), k);
  say("\nLongest frames:");
  for (const l of [...r.loaf].sort((a, b) => b.duration - a.duration).slice(0, 8)) say(f(l.duration), "render", f(l.render), "style/layout", f(l.styleLayout), l.scripts.map((s) => `${s.inv}/${s.fn}:${s.dur.toFixed(0)}`).join(" | "));
  say("\nmain lag worst:", [...r.lag].sort((a, b) => b.lag - a.lag).slice(0, 8).map((l) => l.lag.toFixed(0)).join(", "), " page", JSON.stringify(r.mem));
  const profile = path.join(out, "renderer.cpuprofile");
  if (existsSync(profile)) lines.push(...profileSummary(JSON.parse(readFileSync(profile, "utf8"))));
  return lines.join("\n");
}

/** The CPU profile's top functions by self and inclusive time. */
function profileSummary(p) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map();
  let total = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const ms = (p.timeDeltas[i] ?? 0) / 1000;
    total += ms;
    self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + ms);
  }
  const name = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
  const selfBy = {};
  const inclusive = {};
  for (const [id, ms] of self) {
    selfBy[name(byId.get(id))] = (selfBy[name(byId.get(id))] ?? 0) + ms;
    const seen = new Set();
    for (let at = id; at !== undefined; at = parent.get(at)) {
      const k = name(byId.get(at));
      if (!seen.has(k)) inclusive[k] = (inclusive[k] ?? 0) + ms;
      seen.add(k);
    }
  }
  const top = (by, n) => Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(7)} ${k}`);
  return [`\nCPU profile: ${total.toFixed(0)} ms`, "Top self:", ...top(selfBy, 25), "\nTop inclusive:", ...top(inclusive, 45)];
}

async function main(args) {
  const analyze = option(args, "analyze", undefined);
  if (analyze !== undefined) {
    console.log(summary(path.resolve(analyze)));
    return;
  }
  const appDir = path.resolve(process.env.APP_DIR ?? path.join(root, "apps", "desktop"));
  if (!existsSync(path.join(appDir, "dist", "main.cjs"))) throw new Error(`${appDir} has no dist/main.cjs: build it first (pnpm --filter @storytree/desktop build), or set APP_DIR to a built app`);
  const exe = process.env.ELECTRON_EXE ?? createRequire(path.join(appDir, "package.json"))("electron");
  const homeFrom = option(args, "home-from", process.env.STORYTREE_HOME ?? path.join(homedir(), ".storytree", "0.3"));
  const out = path.resolve(option(args, "out", path.join(tmpdir(), `lag-desktop-${new Date().toISOString().replace(/[:.]/g, "-")}`)));
  const extraArgs = (process.env.ELECTRON_ARGS ?? "").split(" ").filter(Boolean);
  await measure({ appDir, exe, extraArgs, homeFrom, project: option(args, "project", undefined), out });
  console.log(`\n${summary(out)}`);
  console.log(`\nlag:desktop: the run is in ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      console.error(`lag:desktop: ${error.message}`);
      process.exit(1);
    },
  );
}
