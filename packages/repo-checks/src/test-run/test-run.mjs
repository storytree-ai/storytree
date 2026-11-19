// Capability 7 · Own health

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { ALSO_OWNED, packageOf } from "@storytree/map/package-of";

import { CI_PLATFORMS, recordHealth, unseenPlatform, verdictOf } from "@storytree/ci-health";

import { parseJunit } from "@storytree/base-dev-loop/junit";

export { CI_PLATFORMS, recordHealth, unseenPlatform };

export { packageOf };

export { parseJunit };

export const VERIFIED_BY = "storytree test run";

export const VERIFIED_BY_CI = "storytree test run on CI";

export function readCiEvidence(directory, { commit, run, platform }) {
  if (!directory || !commit || !run || !Object.hasOwn(CI_PLATFORMS, platform)) return undefined;
  try {
    const reports = readdirSync(directory).map((entry) => JSON.parse(readFileSync(path.join(directory, entry, "result.json"), "utf8")));
    if (reports.length === 0 || reports.some((report) => report.run !== run || !validEvidence(report, commit, platform))) return undefined;
    return { platform, commit, run, code: 0, results: reports.flatMap((report) => report.results) };
  } catch {
    return undefined;
  }
}

function validEvidence(evidence, commit, platform = evidence?.platform) {
  return /^[a-f0-9]{40}$/.test(commit ?? "") && evidence?.commit === commit && Object.hasOwn(CI_PLATFORMS, platform) && evidence.platform === platform && evidence.code === 0 &&
    /^https:\/\/[^/]+\/[^/]+\/[^/]+\/actions\/runs\/\d+\/attempts\/\d+$/.test(evidence.run ?? "") &&
    Array.isArray(evidence.results) && evidence.results.every((test) =>
      typeof test.name === "string" && Array.isArray(test.suites) && test.suites.every((suite) => typeof suite === "string") &&
      typeof test.file === "string" && test.file !== "" && !test.file.startsWith("/") && !/[\\:]/.test(test.file) && !test.file.split("/").includes("..") &&
      ["passed", "failed", "skipped"].includes(test.status));
}

export function creditPlatforms(results, evidence, { root, commit }) {
  const key = (test, file = test.file) => JSON.stringify([file, test.suites, test.name]);
  const byPlatform = new Map();
  for (const run of evidence) {
    if (run === undefined || !validEvidence(run, commit)) continue;
    const byTest = new Map();
    for (const test of run.results) {
      const id = key(test);
      byTest.set(id, [...(byTest.get(id) ?? []), test]);
    }
    byPlatform.set(run.platform, { run: run.run, byTest, files: new Set(run.results.map((test) => test.file)) });
  }
  return results.map((test) => {
    if (test.status === "failed") {
      const file = path.relative(root, path.resolve(root, test.file)).replaceAll("\\", "/");
      return [...byPlatform.values()].some((proof) => proof.byTest.has(key(test, file))) ? { ...test, flaky: true } : test;
    }
    const platform = test.status === "skipped" ? /^platform:([a-z0-9]+)(?:[-\s:]|$)/.exec(test.message ?? "")?.[1] : undefined;
    const proof = platform === undefined ? undefined : byPlatform.get(platform);
    if (proof === undefined) return test;
    const file = path.relative(root, path.resolve(root, test.file)).replaceAll("\\", "/");
    if (!proof.files.has(file)) return { ...test, unrun: true };
    const matches = proof.byTest.get(key(test, file));
    return matches?.length && matches.every((match) => match.status === "passed") ? { ...test, status: "passed", ciRun: `${CI_PLATFORMS[platform]}: ${proof.run}` } : test;
  });
}

export function contractsCoveredBy(file, { root, prefix }) {
  const numbers = new Set();
  const seen = new Set();
  const queue = [path.resolve(file)];
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    let text;
    try {
      text = readFileSync(current, "utf8");
    } catch {
      continue;
    }
    for (const title of titlesIn(text, prefix)) {
      for (const number of leadingContracts(title)) numbers.add(number);
    }
    for (const [, specifier] of text.matchAll(/(?:\bfrom|\bimport)\s*(?:\(\s*)?["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = moduleFile(path.resolve(path.dirname(current), specifier));
      if (target !== undefined && !path.relative(root, target).startsWith("..")) queue.push(target);
    }
  }
  return numbers;
}

function titlesIn(text, prefix) {
  const lead = prefix === undefined ? "" : `${prefix.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")}\\s+`;
  const titles = [...text.matchAll(new RegExp(`[\\w$.]\\s*\\(\\s*["'\`]${lead}(\\d+\\.\\d+[^"'\`\\r\\n]*)`, "g"))].map(([, title]) => title);
  for (const [, name] of text.matchAll(/[\w$.]\s*\(\s*(?:`\$\{\s*)?([A-Za-z_$][\w$]*)\s*[,)}]/g)) {
    const constant = text.match(new RegExp(`\\bconst\\s+${name.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")}\\s*=\\s*["'\`]${lead}(\\d+\\.\\d+[^"'\`\\r\\n]*)`));
    if (constant !== null) titles.push(constant[1]);
  }
  return titles;
}

export function dependantTestsNaming(own, { root }) {
  const packages = path.join(root, "packages");
  let names;
  try {
    names = readdirSync(packages);
  } catch {
    return [];
  }
  const files = [];
  const owned = ownedBy(own);
  for (const name of names.filter((name) => !owned.includes(name)).sort()) {
    const source = path.join(packages, name, "src");
    let entries;
    try {
      entries = readdirSync(source, { recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries.map(String).filter((entry) => /\.test\.m?[jt]s$/.test(entry) && !entry.split(/[\\/]/).includes("node_modules")).sort()) {
      const file = path.join(source, entry);
      if (contractsCoveredBy(file, { root: source, prefix: own }).size > 0) files.push(path.relative(root, file).replaceAll("\\", "/"));
    }
  }
  return files;
}

function moduleFile(target) {
  const candidates = [target, target.replace(/\.js$/, ".ts"), target.replace(/\.mjs$/, ".mts"), `${target}.ts`];
  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

export function judge({ contracts, results, coverage, show = (file) => file, prefix, dependant = () => false }) {
  const known = new Set(contracts);
  const tests = new Map(contracts.map((number) => [number, []]));
  const unmapped = [];
  const stray = [];
  const crashedFiles = [];
  const crashedUnder = new Map();

  for (const result of results) {
    if (isFileResult(result)) {
      if (result.status !== "failed") continue;
      const held = [...coverage(result.file)].filter((number) => known.has(number)).sort(byNumber);
      crashedFiles.push({ file: result.file, contracts: held });
      for (const number of held) if (!crashedUnder.has(number)) crashedUnder.set(number, result.file);
      continue;
    }
    const prefixedOnly = dependant(result.file);
    const named = contractsOfResult(result, prefix, prefixedOnly);
    const numbers = named.filter((number) => known.has(number));
    const lacking = named.filter((number) => !known.has(number));
    if (prefixedOnly && lacking.length > 0) stray.push({ result, numbers: lacking });
    if (numbers.length === 0 && prefixedOnly) continue;
    if (numbers.length === 0) unmapped.push(result);
    else for (const number of numbers) tests.get(number).push(result);
  }

  const verdicts = new Map();
  for (const number of contracts) {
    const own = tests.get(number);
    const { note, tests: named, ...judged } = verdictOf(own);
    const counts = { passed: judged.passed, failed: judged.failed, skipped: judged.skipped, total: judged.total };
    const ciRuns = [...new Set(own.map((test) => test.ciRun).filter(Boolean))];
    let verdict;
    if (judged.state !== "failing" && crashedUnder.has(number)) {
      verdict = { number, state: "not-checked", ...counts, crashed: true, reason: `${show(crashedUnder.get(number))} produced no results (its process died before running any test)` };
    } else if (judged.state !== "not-checked") {
      const flaky = own.filter((test) => test.status === "failed" && test.flaky === true).map(({ suites, name }) => [...suites, name].join(" › "));
      verdict = { number, state: judged.state, ...counts, note: `${note}${ciRuns.map((run) => `; ${run}`).join("")}`, ...(named === undefined ? {} : { tests: named }), ...(flaky.length === 0 ? {} : { flaky }) };
    }
    else {
      const unrun = judged.skip !== undefined && own.every(({ status, unrun }) => status !== "skipped" || unrun === true);
      verdict = { number, state: "not-checked", ...counts, ...(judged.skip === undefined ? {} : { skip: judged.skip }), reason: note, ...(unrun ? { unrun } : {}) };
    }
    verdicts.set(number, verdict);
  }
  return { verdicts, unmapped, stray, crashedFiles };
}

function isFileResult(result) {
  const name = result.name.replaceAll("\\", "/").toLowerCase();
  const file = result.file.replaceAll("\\", "/").toLowerCase();
  return result.suites.length === 0 && /\.test\.[cm]?[jt]sx?$/.test(name) && file.endsWith(name);
}

function spacedRest(text) {
  const rest = text.trimStart();
  return rest.length < text.length ? rest : undefined;
}

function contractsOfResult(result, prefix, prefixedOnly) {
  for (const name of [...result.suites, result.name]) {
    const after = prefix === undefined || !name.startsWith(prefix) ? undefined : spacedRest(name.slice(prefix.length));
    const numbers = leadingContracts(after ?? (prefixedOnly ? "" : name));
    if (numbers.length > 0) return numbers;
  }
  return [];
}

const LEADING_LIST_LIMIT = 256;

function leadingContracts(title) {
  const prefix = /^(\d+\.\d+(?:–\d+\.\d+)?(?:(?:\s*[,/]\s*|\s+and\s+)\d+\.\d+(?:–\d+\.\d+)?)*):?(?=\s|$)/.exec(title)?.[1];
  if (prefix === undefined) return [];
  const ranges = [];
  let width = 0;
  for (const [first, last] of prefix.split(/[,/]|\sand\s/).map((entry) => entry.trim().split("–"))) {
    const [capability, start] = first.split(".").map(Number);
    const [endCapability, end] = (last ?? first).split(".").map(Number);
    if (capability !== endCapability || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return [];
    width += end - start + 1;
    if (width > LEADING_LIST_LIMIT) return [];
    ranges.push({ first, capability, start, end });
  }
  const numbers = new Set();
  for (const { first, capability, start, end } of ranges) {
    numbers.add(first);
    for (let n = start + 1; n <= end; n++) numbers.add(`${capability}.${n}`);
  }
  return [...numbers];
}

function byNumber(a, b) {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return a1 - b1 || a2 - b2;
}

export function contractsOf(story) {
  const contractIds = new Map();
  for (const capability of story.capabilities) {
    for (const contract of capability.contracts) {
      const number = /^(\d+\.\d+) · /.exec(contract.title)?.[1];
      if (number !== undefined) contractIds.set(number, contract.id);
    }
  }
  return { numbers: [...contractIds.keys()], contractIds };
}

export function sourcesOf(name) {
  return name === "app" ? ["packages/app/src", "apps/desktop/src"] : ownedBy(name).map((owned) => `packages/${owned}/src`);
}

function ownedBy(name) {
  return [name, ...(Object.hasOwn(ALSO_OWNED, name) ? ALSO_OWNED[name] : [])];
}

function optional(field, value) {
  return value === undefined || value === "" ? {} : { [field]: value };
}

export async function markPending(library, story, writer, { root }) {
  const name = packageOf(story);
  const named = new Set();
  for (const dir of sourcesOf(name)) {
    const source = path.join(root, dir);
    let entries;
    try {
      entries = readdirSync(source, { recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries.map(String).filter((entry) => /\.test\.m?[jt]s$/.test(entry) && !entry.split(/[\\/]/).includes("node_modules"))) {
      for (const number of contractsCoveredBy(path.join(source, entry), { root: source })) named.add(number);
    }
  }
  for (const file of dependantTestsNaming(name, { root })) {
    for (const number of contractsCoveredBy(path.join(root, file), { root: path.join(root, "packages"), prefix: name })) named.add(number);
  }
  const marked = [];
  const note = `a test run${writer.commit === undefined ? "" : ` at commit ${writer.commit}`} is recording it`;
  for (const capability of story.capabilities) {
    for (const contract of capability.contracts) {
      const number = /^(\d+\.\d+) · /.exec(contract.title)?.[1];
      const { state, skip } = contract.health.verified;
      if (number === undefined || !named.has(number) || state === "passing" || (state === "not-checked" && skip !== undefined)) continue;
      await library.markVerifiedPending(contract.id, { by: writer.by, note });
      marked.push(number);
    }
  }
  return marked;
}

export function recordingTarget({ env, setting }) {
  if (env.GITHUB_ACTIONS === "true") {
    const writer = { by: VERIFIED_BY_CI, source: "ci", ...optional("commit", env.GITHUB_SHA) };
    if ((env.HEALTH_PG_ADDRESS ?? "") !== "") return { record: true, library: { address: env.HEALTH_PG_ADDRESS }, writer };
    return {
      record: false,
      why:
        "CI has no library to record health in: the repository variable HEALTH_PG_ADDRESS is unset " +
        "(infra/library-host/README.md says how CI reaches the Mint box). Nothing was recorded.",
    };
  }
  if (setting.location === "postgres") return { record: true, library: { address: setting.address }, writer: { by: VERIFIED_BY, source: "local" } };
  return { record: true, library: "app", writer: { by: VERIFIED_BY, source: "local" } };
}
