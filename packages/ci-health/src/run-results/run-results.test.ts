import assert from "node:assert/strict";
import { test } from "node:test";
import { commitOfLog, parseTestLog } from "./run-results.js";

/** A job log as the Actions API gives it: every line timestamped, the BOM on the first. */
const API_LOG = [
  "﻿2026-10-03T20:20:23.0090422Z Current runner version: '2.337.0'",
  "2026-10-03T20:20:26.1000000Z > node --test",
  "2026-10-03T20:20:26.1100000Z TAP version 13",
  "2026-10-03T20:20:26.1200000Z # Subtest: 3.1 pages show a cart button per product",
  "2026-10-03T20:20:26.1300000Z ok 1 - 3.1 pages show a cart button per product",
  "2026-10-03T20:20:26.1400000Z   ---",
  "2026-10-03T20:20:26.1500000Z   duration_ms: 3.04",
  "2026-10-03T20:20:26.1600000Z   ...",
  "2026-10-03T20:20:26.1700000Z not ok 2 - 1.2 missing details show the error \\# in place",
  "2026-10-03T20:20:26.1800000Z ok 3 - 1.3 a later part # SKIP not on this platform",
  "2026-10-03T20:20:26.1900000Z ok 4 - 1.4 a planned test # TODO",
  "2026-10-03T20:20:26.2000000Z # Subtest: 2.1 the admin page",
  "2026-10-03T20:20:26.2100000Z     # Subtest: lists every product",
  "2026-10-03T20:20:26.2200000Z     ok 1 - lists every product",
  "2026-10-03T20:20:26.2300000Z     not ok 2 - saves a row",
  "2026-10-03T20:20:26.2400000Z     1..2",
  "2026-10-03T20:20:26.2500000Z not ok 5 - 2.1 the admin page",
  "2026-10-03T20:20:26.2600000Z 1..5",
  "2026-10-03T20:20:26.2700000Z # tests 6",
  "2026-10-03T20:20:26.2800000Z # pass 3",
].join("\n");

/** The same kind of log as `gh run view --log` saves it: job and step columns first. */
const SAVED_LOG = [
  "test\tRun actions/checkout@v4\t2026-10-03T20:20:24.4233216Z [command]/usr/bin/git log -1 --format=%H",
  "test\tRun actions/checkout@v4\t2026-10-03T20:20:24.4262519Z 7f745ec5218a72a19aef3953e4b7b91aca6a8e76",
  "test\tRun npm test\t2026-10-03T20:20:26.6330349Z ok 1 - 1.1 product page shows the product",
  "test\tRun npm test\t2026-10-03T20:20:26.6410561Z ok 2 - not numbered at all",
].join("\n");

test("1.1 a job log's TAP reads as one result per test: ok passed, not ok failed, SKIP or TODO skipped, a subtest under its parent's name; other lines give nothing", () => {
  assert.deepEqual(parseTestLog(API_LOG), [
    { name: "3.1 pages show a cart button per product", suites: [], status: "passed" },
    { name: "1.2 missing details show the error # in place", suites: [], status: "failed" },
    { name: "1.3 a later part", suites: [], status: "skipped", message: "not on this platform" },
    { name: "1.4 a planned test", suites: [], status: "skipped" },
    { name: "lists every product", suites: ["2.1 the admin page"], status: "passed" },
    { name: "saves a row", suites: ["2.1 the admin page"], status: "failed" },
    { name: "2.1 the admin page", suites: [], status: "failed" },
  ]);
  assert.deepEqual(parseTestLog(SAVED_LOG), [
    { name: "1.1 product page shows the product", suites: [], status: "passed" },
    { name: "not numbered at all", suites: [], status: "passed" },
  ]);
  assert.deepEqual(parseTestLog("no tests ran here\nok computer"), []);
});

test("1.2 the commit a run tested is read from its log's checkout, and a log that names none gives no commit", () => {
  assert.equal(commitOfLog(SAVED_LOG), "7f745ec5218a72a19aef3953e4b7b91aca6a8e76");
  assert.equal(commitOfLog(API_LOG), undefined);
});
