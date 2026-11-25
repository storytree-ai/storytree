// Capability 11 · Rebuild pilot measures

import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { parseSync } from "oxc-parser";

const LIBRARY = "packages/library";
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const CONTRACT = /^(\d+\.\d+)(?=\s|$)/;
const TESTS = new Set(["test", "it"]);

function testFiles(root, folder) {
  const found = [];
  for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const file = path.posix.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(root, file));
    else if (entry.isFile() && TEST_FILE.test(entry.name)) found.push(file);
  }
  return found;
}

function textOf(node, source) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral") return node.expressions.length === 0 ? node.quasis[0].value.cooked : source.slice(node.start + 1, node.end - 1);
  return undefined;
}

function testsIn(file, source) {
  const { program } = parseSync(file, source, { sourceType: "module" });
  const found = [];
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const each of node) visit(each);
      return;
    }
    if (node.type === "CallExpression" && node.callee.type === "Identifier") {
      const [first, second] = node.arguments;
      if (TESTS.has(node.callee.name)) {
        const title = textOf(first, source);
        if (title !== undefined) found.push({ at: node.start, title, contract: CONTRACT.exec(title)?.[1] ?? null });
      } else if (node.callee.name === "contract") {
        const [number, title] = [textOf(first, source), textOf(second, source)];
        if (number !== undefined && title !== undefined) found.push({ at: node.start, title, contract: number });
      }
    }
    for (const [key, value] of Object.entries(node)) if (key !== "parent") visit(value);
  };
  visit(program);
  return found.sort((a, b) => a.at - b.at);
}

export async function listOracle(checkout) {
  const tests = [];
  for (const file of testFiles(checkout, LIBRARY).sort()) {
    const bytes = readFileSync(path.join(checkout, file));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    for (const { title, contract } of testsIn(file, bytes.toString("utf8"))) tests.push({ file, sha256, title, contract });
  }
  return { tests };
}

export async function compareOracle(frozen, current) {
  const left = new Map();
  for (const { title } of current.tests) left.set(title, (left.get(title) ?? 0) + 1);
  const missingTitles = [];
  for (const { title } of frozen.tests) {
    const count = left.get(title) ?? 0;
    if (count > 0) left.set(title, count - 1);
    else missingTitles.push(title);
  }
  const carried = new Set(current.tests.map(({ contract }) => contract));
  const missingContracts = [...new Set(frozen.tests.map(({ contract }) => contract))].filter((contract) => contract !== null && !carried.has(contract));
  return { missingContracts, missingTitles };
}

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  const median = sorted.length % 2 === 1 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { median, min: sorted[0], max: sorted.at(-1) };
}

export async function readRuntime({ checkout, url, runs = 5 }) {
  const { connect } = await import(pathToFileURL(path.join(checkout, LIBRARY, "src", "index.ts")).href);
  const storytree = await connect({ url });
  const readings = [];
  try {
    for (let run = 0; run < runs; run++) {
      const name = `pilot-${randomBytes(4).toString("hex")}`;
      try {
        const opening = performance.now();
        const library = await storytree.openProject(name);
        const openMs = performance.now() - opening;
        try {
          const writing = performance.now();
          const note = await library.defineTerm({ term: "Pilot", meaning: "A round trip the pilot times." });
          await library.get(note.id);
          readings.push({ openMs, roundTripMs: performance.now() - writing });
        } finally {
          await library.close();
        }
      } finally {
        if ((await storytree.listProjects()).includes(name)) await storytree.dropProject(name);
      }
    }
  } finally {
    await storytree.close();
  }
  return {
    runs: readings,
    summary: { openMs: summarise(readings.map(({ openMs }) => openMs)), roundTripMs: summarise(readings.map(({ roundTripMs }) => roundTripMs)) },
  };
}

async function main([verb, ...rest]) {
  if (verb === "oracle") return listOracle(path.resolve(rest[0]));
  if (verb === "compare") return compareOracle(JSON.parse(readFileSync(rest[0], "utf8")), await listOracle(path.resolve(rest[1])));
  if (verb === "runtime") {
    const option = (flag) => rest[rest.indexOf(flag) + 1];
    return readRuntime({ checkout: path.resolve(rest[0]), url: option("--url"), ...(rest.includes("--runs") ? { runs: Number(option("--runs")) } : {}) });
  }
  return { usage: "library-pilot.mjs oracle <checkout> | compare <frozen.json> <checkout> | runtime <checkout> --url <postgres url> [--runs N]" };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  import("tsx/esm/api").then(({ register }) => register()).then(() => main(process.argv.slice(2))).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => console.log(JSON.stringify({ error: String(error?.message ?? error) })),
  );
}
