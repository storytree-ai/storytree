import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { releasesLog, waitingLine } from "./releases-log.js";

test("4.19 releases.log keeps the update lines a person reads and never the updater's blockmap dumps", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "releases-log-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "releases.log");
  const log = releasesLog(file, { echo: () => {} });

  log.info("Following the development release channel");
  log.info("Found version 0.3.912 (url: storytree-0.3.912.exe)");
  // electron-updater's differential downloader writes both of these at debug (measured: ~94 MB in a week).
  log.debug(JSON.stringify([{ kind: 0, start: 0, end: 10 }, { kind: 1, start: 10, end: 20 }], null, 2));
  log.debug("Hc1Z duplicated in blockmap (same size), it doesn't lead to broken differential downloader, just corresponding block will be skipped)");
  log.warn("Cannot download differentially, fallback to full download");
  log.error(new Error("net::ERR_INTERNET_DISCONNECTED"));

  // An error keeps its stack, so entries are split at each one's timestamp.
  const lines = readFileSync(file, "utf8").split(/^\d{4}-\d\d-\d\dT\S+ /m).slice(1);
  assert.equal(lines.length, 4);
  assert.match(lines[0]!, /^Following the development release channel\n$/);
  assert.match(lines[1]!, /^Found version 0\.3\.912/);
  assert.match(lines[2]!, /fallback to full download/);
  assert.match(lines[3]!, /ERR_INTERNET_DISCONNECTED/);
});

test("4.19 releases.log stays under its cap: past it, the file starts again and the previous one is kept beside it", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "releases-log-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "releases.log");
  const log = releasesLog(file, { echo: () => {}, capBytes: 1_000 });

  for (let i = 0; i < 200; i++) log.info(`Checking for update ${i}`);

  assert.ok(statSync(file).size <= 1_000);
  assert.ok(statSync(`${file}.1`).size <= 1_000);
  assert.match(readFileSync(file, "utf8"), /Checking for update 199\n$/);
});

test("4.19 the waiting line names the install choice holding a downloaded release", () => {
  assert.match(waitingLine({ mode: "manual" }), /only when the user chooses \(manual only\)/);
  assert.match(waitingLine({ mode: "hours", from: "01:00", to: "05:00" }), /inside quiet hours 01:00–05:00/);
  assert.match(waitingLine({ mode: "quiet" }), /quiet moment/);
});
