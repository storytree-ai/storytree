// Capability 4 · Updates
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";

import { ConnectionError } from "@storytree/library/connection-error";

import { channelOffered, installationFolder, keepCheckingReleases, refreshAgentTools, RELEASE_CHECK_EVERY_MS } from "./follow-releases.js";
import { appVersion } from "./version.js";

test("4.30 a following app checks for a release at start and every three minutes until it quits; a failed check is logged and the next goes ahead, and a waiting release says when it installs", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const answers: Array<string | Error> = ["none", new Error("offline"), "waiting"];
  const lines: string[] = [];
  let checks = 0;
  let stopped = false;
  const checking = keepCheckingReleases({
    updater: {
      check: async () => {
        const answer = answers[checks++] ?? "none";
        if (answer instanceof Error) throw answer;
        return answer;
      },
      stop: () => { stopped = true; },
    },
    log: { info: (line) => lines.push(line), error: (error) => lines.push(`error: ${(error as Error).message}`) },
    waiting: () => "installs at the next quiet moment",
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  assert.equal(checks, 1, "it checks as it starts");
  t.mock.timers.tick(RELEASE_CHECK_EVERY_MS - 1);
  await settle();
  assert.equal(checks, 1, "and not again before three minutes");
  t.mock.timers.tick(1);
  await settle();
  t.mock.timers.tick(RELEASE_CHECK_EVERY_MS);
  await settle();
  assert.equal(checks, 3, "a failed check does not stop the next");
  assert.deepEqual(lines, ["error: offline", "installs at the next quiet moment"]);
  assert.equal(RELEASE_CHECK_EVERY_MS, 180_000);

  checking.stop();
  assert.equal(stopped, true, "quitting stops the updater");
  t.mock.timers.tick(RELEASE_CHECK_EVERY_MS * 3);
  await settle();
  assert.equal(checks, 3, "and no check runs after it");
});

test("4.51 · release checks failing through a library outage say it once, as one line with no stack, then once that the library answers again when a check succeeds; any other failed check is logged in full each time", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const outage = new ConnectionError("unreachable", "The library cannot be reached: connect EHOSTUNREACH 100.64.0.1:5432");
  const broken = new Error("the release feed answered 500");
  const answers: Array<string | Error> = [outage, outage, outage, "none", "none", broken, broken];
  const said: Array<{ to: "info" | "error"; what: unknown }> = [];
  let checks = 0;
  const checking = keepCheckingReleases({
    updater: {
      check: async () => {
        const answer = answers[checks++] ?? "none";
        if (answer instanceof Error) throw answer;
        return answer;
      },
      stop: () => {},
    },
    log: { info: (line) => said.push({ to: "info", what: line }), error: (error) => said.push({ to: "error", what: error }) },
    waiting: () => "installs at the next quiet moment",
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const nextCheck = async () => { t.mock.timers.tick(RELEASE_CHECK_EVERY_MS); await settle(); };
  try {
    await settle();
    await nextCheck();
    await nextCheck();
    assert.equal(checks, 3);
    assert.equal(said.length, 1, "three checks failing through the outage say it once");
    const [line] = said;
    assert.equal(line?.to, "error");
    assert.equal(typeof line?.what, "string", "a line, not the error with its stack");
    assert.doesNotMatch(line?.what as string, /\n/, "one line");
    assert.match(line?.what as string, /The library cannot be reached: connect EHOSTUNREACH 100\.64\.0\.1:5432/);

    await nextCheck();
    assert.equal(said.length, 2);
    assert.equal(typeof said[1]?.what, "string");
    assert.match(said[1]?.what as string, /the library answers again$/);
    await nextCheck();
    assert.equal(said.length, 2, "a later success says nothing more");

    await nextCheck();
    await nextCheck();
    assert.equal(checks, 7);
    assert.deepEqual(said.slice(2), [{ to: "error", what: broken }, { to: "error", what: broken }], "any other failure is logged in full, each check");
  } finally {
    checking.stop();
  }
});

test("4.31 only an installed Linux AppImage refreshes the agent tools beside it, and a refresh that fails is said", () => {
  const run = (platform: NodeJS.Platform, appImage: string | undefined, refresh: (folder: string) => boolean = () => true) => {
    const folders: string[] = [];
    const lines: string[] = [];
    refreshAgentTools({
      platform,
      appImage,
      refresh: (folder) => { folders.push(folder); return refresh(folder); },
      log: { log: (line) => lines.push(line), error: (line) => lines.push(`error: ${line}`) },
    });
    return { folders, lines };
  };
  assert.deepEqual(run("linux", "/home/u/Applications/storytree.AppImage"), { folders: ["/home/u/Applications"], lines: ["Agent tools updated to this build's"] });
  assert.deepEqual(run("linux", "/home/u/Applications/storytree.AppImage", () => false), { folders: ["/home/u/Applications"], lines: [] }, "tools already this build's are said nothing of");
  assert.deepEqual(run("linux", undefined), { folders: [], lines: [] }, "a Linux app that is not an AppImage refreshes none");
  assert.deepEqual(run("win32", "C:\\storytree.AppImage"), { folders: [], lines: [] });
  assert.deepEqual(run("darwin", undefined), { folders: [], lines: [] });
  assert.deepEqual(run("linux", "/apps/storytree.AppImage", () => { throw new Error("read-only"); }).lines, ["error: Agent tools could not be updated: read-only"]);
});

test("4.42 an installed Windows or Mac app's start points the agents at its own build's copy of the tools, says which moved and which did not with why, and starts all the same", async () => {
  type Followed = { moved: string[]; notMoved: { agent: string; reason: string }[] } | undefined;
  const run = async (platform: NodeJS.Platform, follow: () => Promise<Followed>) => {
    const lines: string[] = [];
    let followed = 0;
    await refreshAgentTools({
      platform,
      appImage: undefined,
      refresh: () => { throw new Error("no AppImage refresh on Windows"); },
      follow: () => { followed++; return follow(); },
      log: { log: (line) => lines.push(line), error: (line) => lines.push(`error: ${line}`) },
    });
    return { followed, lines };
  };
  assert.deepEqual(await run("win32", async () => ({ moved: ["Claude Code", "Codex"], notMoved: [] })), { followed: 1, lines: ["Claude Code and Codex now run this build's copy of the agent tools"] });
  assert.deepEqual(await run("win32", async () => ({ moved: ["Codex"], notMoved: [{ agent: "Claude Code", reason: "Install Claude Code, then retry." }] })), { followed: 1, lines: [
    "Codex now runs this build's copy of the agent tools",
    "error: Claude Code still runs an older copy of the agent tools, tried again at the next start: Install Claude Code, then retry.",
  ] });
  assert.deepEqual(await run("win32", async () => undefined), { followed: 1, lines: [] }, "agents already on this build's copy are said nothing of");
  assert.deepEqual(await run("win32", async () => ({ moved: [], notMoved: [] })), { followed: 1, lines: [] }, "nor is a move with no agent connected");
  assert.deepEqual(await run("win32", async () => { throw new Error("disk full"); }), { followed: 1, lines: ["error: Agent tools could not be pointed at this build's: disk full"] });
  assert.deepEqual(await run("darwin", async () => ({ moved: ["Claude Code"], notMoved: [] })), { followed: 1, lines: ["Claude Code now runs this build's copy of the agent tools"] }, "an installed Mac's start follows its build too");
});

test("4.42 an installed Linux AppImage's start refreshes the tools beside it, then points the agents at that build's copy; one that is not an AppImage does neither", async () => {
  const run = async (appImage: string | undefined, refresh: () => boolean = () => true) => {
    const steps: string[] = [];
    await refreshAgentTools({
      platform: "linux",
      appImage,
      refresh: (folder) => { steps.push(`refresh ${folder}`); return refresh(); },
      follow: async () => { steps.push("follow"); return { moved: ["Codex"], notMoved: [] }; },
      log: { log: (line) => steps.push(line), error: (line) => steps.push(`error: ${line}`) },
    });
    return steps;
  };
  assert.deepEqual(await run("/home/u/Applications/storytree.AppImage"), [
    "refresh /home/u/Applications", "Agent tools updated to this build's", "follow", "Codex now runs this build's copy of the agent tools",
  ]);
  assert.deepEqual(await run("/apps/storytree.AppImage", () => { throw new Error("read-only"); }), [
    "refresh /apps", "error: Agent tools could not be updated: read-only", "follow", "Codex now runs this build's copy of the agent tools",
  ], "a failed refresh is said, and the agents still follow whichever build's tools the folder holds");
  assert.deepEqual(await run(undefined), []);
});

test("4.42 the installation a start follows is the AppImage's folder on Linux, the .app bundle on a Mac, and the exe's folder on Windows", () => {
  assert.equal(installationFolder({ platform: "linux", execPath: "/tmp/.mount_storyXY/storytree-0.3", appImage: "/home/u/.local/share/storytree-0.3/storytree-0.3.AppImage" }), "/home/u/.local/share/storytree-0.3");
  assert.equal(installationFolder({ platform: "darwin", execPath: "/Applications/storytree-0.3.app/Contents/MacOS/storytree-0.3", appImage: undefined }), "/Applications/storytree-0.3.app");
  assert.equal(installationFolder({ platform: "win32", execPath: path.join("C:", "Programs", "storytree-0.3", "storytree-0.3.exe"), appImage: undefined }), path.join("C:", "Programs", "storytree-0.3"));
});

registerHooks({
  resolve(specifier, context, next) {
    const host = /[?&]host=(win32|posix)\b/.exec(context.parentURL ?? "")?.[1];
    if (host === undefined) return next(specifier, context);
    if (specifier === "node:path" || specifier === "path") return { url: `data:text/javascript,import p from "node:path"; export default p.${host};`, shortCircuit: true };
    const resolved = next(specifier, context);
    return resolved.url.startsWith("file:") && !resolved.url.includes("/node_modules/") ? { ...resolved, url: `${resolved.url}?host=${host}` } : resolved;
  },
});
const underHost = async (host: "win32" | "posix") => (await import(`./follow-releases.js?host=${host}`)) as typeof import("./follow-releases.js");

test("4.42 · the installation folder is the same whichever host's path module computes it (escape_82042510e491)", async () => {
  for (const host of ["win32", "posix"] as const) {
    const { installationFolder: folder } = await underHost(host);
    assert.equal(folder({ platform: "linux", execPath: "/tmp/.mount_storyXY/storytree-0.3", appImage: "/home/u/.local/share/storytree-0.3/storytree-0.3.AppImage" }), "/home/u/.local/share/storytree-0.3", `the AppImage's folder under a ${host} host`);
    assert.equal(folder({ platform: "darwin", execPath: "/Applications/storytree-0.3.app/Contents/MacOS/storytree-0.3", appImage: undefined }), "/Applications/storytree-0.3.app", `the .app bundle under a ${host} host`);
    assert.equal(folder({ platform: "win32", execPath: "C:\\Programs\\storytree-0.3\\storytree-0.3.exe", appImage: undefined }), "C:\\Programs\\storytree-0.3", `the exe's folder under a ${host} host`);
  }
});

test("4.32 the gear offers the update channel only where releases install themselves, and never in a smoke check", () => {
  assert.equal(channelOffered({ smoke: false, followsReleases: true }), true);
  assert.equal(channelOffered({ smoke: false, followsReleases: false }), false);
  assert.equal(channelOffered({ smoke: true, followsReleases: true }), false);
});

test("4.33 the running app reports Electron's version when packaged, else its checkout's, else 0.3.0", () => {
  const source = (from: string) => from === "/checkout" ? { version: "0.3.57" } : undefined;
  assert.equal(appVersion({ packaged: true, packagedVersion: () => "0.3.60", appPath: "/checkout", source }), "0.3.60");
  assert.equal(appVersion({ packaged: false, packagedVersion: () => "0.3.60", appPath: "/checkout", source }), "0.3.57");
  assert.equal(appVersion({ packaged: false, packagedVersion: () => "0.3.60", appPath: "/elsewhere", source }), "0.3.0");
});
