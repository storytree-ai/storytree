// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import * as oxlint from "../oxlint.mjs";
import plugin from "./index.mjs";

const rule = plugin.rules["poll-says-outage-once"];
const at = (file) => path.join(process.cwd(), file);
const SOURCE = at("packages/app/src/updates/follow-releases.ts");
const code = (...lines) => lines.join("\n").replaceAll("#{", "${");
const refused = (line, text, filename = SOURCE) => ({ code: text, filename, errors: [{ messageId: "everyTick", line }] });
const passes = (text, filename = SOURCE) => ({ code: text, filename });

const UPDATER = code(
  "export function keepCheckingReleases(updater: { check(): Promise<string> }, log: { error(error: unknown): void }, every = 180_000) {",
  "  const check = async (): Promise<void> => {",
  "    try {",
  "      await updater.check();",
  "    } catch (error) { log.error(error); }",
  "  };",
  "  const timer = setInterval(() => void check(), every);",
  "  timer.unref();",
  "}",
);

const READ_WINDOW = code(
  "export function createKnowledgeCore(project: string, host: { windowReading(project: string, session: string): Promise<unknown> }) {",
  "  let shown: unknown;",
  "  let timer: ReturnType<typeof setInterval> | undefined;",
  "  const readWindow = (session: string): void => {",
  "    host.windowReading(project, session).then((window) => {",
  "      shown = window;",
  "    }, (error: unknown) => {",
  "      console.error(\"knowledge-core: the selected session's window could not be read\", error);",
  "    });",
  "  };",
  "  return {",
  "    select(session: string) {",
  "      readWindow(session);",
  "      timer = setInterval(() => readWindow(session), 10_000);",
  "    },",
  "  };",
  "}",
);

const REARMED = code(
  "let timer: ReturnType<typeof setTimeout> | undefined;",
  "export function refresh(read: () => Promise<void>): void {",
  "  read().catch((error) => {",
  "    console.error(\"sessions could not be refreshed\", error);",
  "  }).finally(() => {",
  "    timer = setTimeout(() => void refresh(read), 3000);",
  "  });",
  "}",
);

const TEMPLATE = code(
  "export function watch(read: () => Promise<void>, log: { error(line: string): void }) {",
  "  const poll = async () => {",
  "    try {",
  "      await read();",
  "    } catch (error) {",
  "      log.error(`the reading failed: #{(error as Error).message}`);",
  "    }",
  "  };",
  "  return setInterval(() => void poll(), 5000);",
  "}",
);

const BY_REFERENCE = code(
  "export function watch(read: () => Promise<void>, log: { error(error: unknown): void }) {",
  "  const poll = async () => {",
  "    try {",
  "      await read();",
  "    } catch (error) { log.error(error); }",
  "  };",
  "  return setInterval(poll, 5000);",
  "}",
);

test("8.29 · storytree/poll-says-outage-once refuses, in a non-test source file under packages/ or apps/, a console.error or <name>.error call passing the caught error (a catch clause's, a .catch or .then rejection handler's) inside a setInterval callback, a setTimeout callback re-arming its own function, or a same-file function either calls by name; its message names escape_221a8ba4aaf6 and outageSaidOnce; the same catch outside a poll, a one-shot setTimeout, a failure told to outageSaidOnce's failed, a line not using the error, a test file and a file outside packages/ and apps/ pass", () => {
  const message = rule?.meta?.messages?.everyTick ?? "";
  assert.match(message, /escape_221a8ba4aaf6/);
  assert.match(message, /outageSaidOnce/);

  new RuleTester({ cwd: process.cwd(), languageOptions: { parserOptions: { lang: "ts" } } }).run("poll-says-outage-once", rule, {
    valid: [
      passes(code(
        "export async function checkOnce(updater: { check(): Promise<string> }, log: { error(error: unknown): void }) {",
        "  try {",
        "    await updater.check();",
        "  } catch (error) { log.error(error); }",
        "}",
      )),
      passes(code(
        "export async function checkOnce(updater: { check(): Promise<string> }, log: { error(error: unknown): void }) {",
        "  try {",
        "    await updater.check();",
        "  } catch (error) { log.error(error); }",
        "}",
        "export function keepTicking(tick: () => void) {",
        "  setInterval(() => tick(), 1000);",
        "}",
      )),
      passes(code(
        "export function remindLater(read: () => Promise<void>) {",
        "  const once = async () => {",
        "    try {",
        "      await read();",
        "    } catch (error) { console.error(\"the reminder failed\", error); }",
        "  };",
        "  setTimeout(() => void once(), 1000);",
        "}",
      )),
      passes(code(
        "export function keepCheckingReleases(updater: { check(): Promise<string> }, outage: { failed(what: string, error: unknown): void; answered(): void }) {",
        "  const check = async (): Promise<void> => {",
        "    try {",
        "      await updater.check();",
        "      outage.answered();",
        "    } catch (error) { outage.failed(\"the release check failed\", error); }",
        "  };",
        "  setInterval(() => void check(), 180_000);",
        "}",
      )),
      passes(code(
        "export function keepCheckingReleases(updater: { check(): Promise<string> }, log: { error(line: string): void }) {",
        "  const check = async (): Promise<void> => {",
        "    try {",
        "      await updater.check();",
        "    } catch { log.error(\"the release check failed\"); }",
        "  };",
        "  setInterval(() => void check(), 180_000);",
        "}",
      )),
      passes(code(
        "export function keepCheckingReleases(updater: { check(): Promise<string> }, log: { error(line: string): void }) {",
        "  const check = async (): Promise<void> => {",
        "    try {",
        "      await updater.check();",
        "    } catch (error) { log.error(\"the release check failed\"); }",
        "  };",
        "  setInterval(() => void check(), 180_000);",
        "}",
      )),
      passes(UPDATER, at("packages/app/src/updates/follow-releases.test.ts")),
      passes(UPDATER, at("scripts/follow-releases.ts")),
    ],
    invalid: [
      refused(5, UPDATER),
      refused(8, READ_WINDOW, at("packages/knowledge-core/src/view/surface.tsx")),
      refused(4, REARMED, at("packages/forest/src/view/sessions-list.ts")),
      refused(6, TEMPLATE),
      refused(5, BY_REFERENCE),
      refused(5, UPDATER, at("apps/desktop/src/updates.ts")),
    ],
  });
});

test("8.29 · through pnpm lint's config, the pre-fix release check's catch in a package's source is one storytree/poll-says-outage-once hit at its line naming escape_221a8ba4aaf6, and the same text in a test file or outside packages/ and apps/ is none", () => {
  const [hits, inTest, outside] = oxlint.ruleHits(["packages/app/src/updates/follow-releases.ts", "packages/app/src/updates/follow-releases.test.ts", "scripts/follow-releases.ts"].map((file) => ({ file, text: UPDATER })))
    .map((each) => each.filter(({ rule: id }) => id === "storytree/poll-says-outage-once"));
  assert.deepEqual(hits.map(({ line }) => line), [5]);
  assert.match(hits[0].message, /escape_221a8ba4aaf6/);

  assert.deepEqual(inTest, []);
  assert.deepEqual(outside, []);
});

const UNREADABLE = [
  "const unreadable = (error: unknown): null => {",
  "  console.error(\"ci-times: the CI reading could not be read\", error);",
  "  return null;",
  "};",
];

const NAMED_CATCH = code(
  ...UNREADABLE,
  "export function showCiTimes(read: () => Promise<string>, paint: (reading: string) => void, everyMs: number) {",
  "  const draw = async (): Promise<void> => {",
  "    const reading = await read().catch(unreadable);",
  "    if (reading !== null) paint(reading);",
  "  };",
  "  void draw();",
  "  setInterval(() => void draw(), everyMs);",
  "}",
);

const NAMED_THEN = code(
  "export function showCiTimes(read: () => Promise<string>, paint: (reading: string) => void, everyMs: number) {",
  "  const draw = (): void => {",
  "    read().then(paint, unreadable);",
  "  };",
  "  setInterval(draw, everyMs);",
  "}",
  "function unreadable(error: unknown): void {",
  "  console.error(\"ci-times: the CI reading could not be read\", error);",
  "}",
);

const ONCE_OUTSIDE_POLL = code(
  ...UNREADABLE,
  "export async function readCiTimesOnce(read: () => Promise<string>): Promise<string | null> {",
  "  return await read().catch(unreadable);",
  "}",
  "export function keepTicking(tick: () => void) {",
  "  setInterval(() => tick(), 1000);",
  "}",
);

const CI_TIMES = "packages/ci-health/src/ci-times/view.ts";
const pollHits = (...texts) => oxlint.ruleHits(texts.map((text) => ({ file: CI_TIMES, text })))
  .map((each) => each.filter(({ rule: id }) => id === "storytree/poll-says-outage-once"));

test("8.29 · storytree/poll-says-outage-once refuses a .catch rejection handler passed by the name of a function in the same file, at that function's console.error of its error, when a setInterval poll reaches the .catch, which through pnpm lint's config is one hit at that line naming escape_221a8ba4aaf6; the same named handler on a read outside any poll, none there too, and a named handler in a poll not passing its error, pass", () => {
  new RuleTester({ cwd: process.cwd(), languageOptions: { parserOptions: { lang: "ts" } } }).run("poll-says-outage-once", rule, {
    valid: [
      passes(ONCE_OUTSIDE_POLL, at(CI_TIMES)),
      passes(code(
        "const unreadable = (error: unknown): null => {",
        "  console.error(\"ci-times: the CI reading could not be read\");",
        "  return null;",
        "};",
        "export function showCiTimes(read: () => Promise<string>, paint: (reading: string) => void, everyMs: number) {",
        "  const draw = async (): Promise<void> => {",
        "    const reading = await read().catch(unreadable);",
        "    if (reading !== null) paint(reading);",
        "  };",
        "  setInterval(() => void draw(), everyMs);",
        "}",
      ), at(CI_TIMES)),
    ],
    invalid: [
      refused(2, NAMED_CATCH, at(CI_TIMES)),
    ],
  });

  const [inPoll, outsidePoll] = pollHits(NAMED_CATCH, ONCE_OUTSIDE_POLL);
  assert.deepEqual(inPoll.map(({ line }) => line), [2]);
  assert.match(inPoll[0].message, /escape_221a8ba4aaf6/);
  assert.deepEqual(outsidePoll, []);
});

test("8.29 · storytree/poll-says-outage-once refuses a .then rejection handler passed by the name of a function declared in the same file, at that function's console.error of its error, when setInterval polls the function holding the .then by reference, which through pnpm lint's config is one hit at that line naming escape_221a8ba4aaf6", () => {
  new RuleTester({ cwd: process.cwd(), languageOptions: { parserOptions: { lang: "ts" } } }).run("poll-says-outage-once", rule, {
    valid: [],
    invalid: [
      refused(8, NAMED_THEN, at(CI_TIMES)),
    ],
  });

  const [hits] = pollHits(NAMED_THEN);
  assert.deepEqual(hits.map(({ line }) => line), [8]);
  assert.match(hits[0].message, /escape_221a8ba4aaf6/);
});
