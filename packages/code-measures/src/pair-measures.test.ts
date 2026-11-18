/**
 * Code measures, capability 2 · Measure records paired with their readers: contracts 2.1 (each live measure record pairs
 * with one reader of its id and version in its story's package, and every one that does not is named, per story, with
 * why) and 2.2 (`storytree code-measures pair` prints that pairing and is refused when any measure does not pair).
 *
 * Each test writes a small checkout in a temp folder: a pnpm workspace whose packages name their story in package.json
 * and declare their readers under `storytree.measures` (a module, by the package's export path, and the export holding
 * an array of readers). Every fixture reader throws if it is read, since pairing reads no value.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbContext, type VerbInputs } from "@storytree/library/verbs";
import { withLibrary } from "@storytree/library/testing/pg";
import { removeTemp } from "@storytree/test-waits";

import * as codeMeasures from "./index.js";
import { CODE_MEASURES_FAMILIES } from "./verbs.js";

/** One reader as a package declares it: the measure record's id and the version it reads. */
interface FixtureReader {
  readonly measure: string;
  readonly version: number;
}

/** A workspace package of the fixture: its folder under packages/, its story, and the readers it declares, if any. */
interface FixturePackage {
  readonly folder: string;
  readonly story?: string;
  readonly readers?: readonly FixtureReader[];
}

/** One measure the pairing names: the measure's id, why it does not pair, and the packages whose readers it names. */
interface Named {
  readonly measure: string;
  readonly why: string;
  readonly packages: readonly string[];
}

/** One story's pairing as pairMeasures returns it. */
interface StoryPairing {
  readonly story: string;
  readonly paired: readonly string[];
  readonly unpaired: readonly Named[];
}

/** The seam the builder provides from the package's index (contract 2.1). */
interface PairingSeam {
  measureReadersOf(folder: string): Promise<{ package: string; story: string | undefined; measure: string; version: number }[]>;
  pairMeasures(records: readonly { id: string; fields: Record<string, unknown> }[], readers: readonly { package: string; story: string | undefined; measure: string; version: number }[]): StoryPairing[];
}

const seam = codeMeasures as unknown as PairingSeam;

/**
 * A pnpm workspace in a temp folder: each package's package.json naming its story and, when it declares readers, an
 * export `./measures` of `src/measures.mjs` holding them as READERS, each with a read that throws.
 */
function checkout(t: TestContext, packages: readonly FixturePackage[]): string {
  const folder = mkdtempSync(path.join(tmpdir(), "code-measures-pair-"));
  t.after(() => removeTemp(folder));
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  };
  write("package.json", '{ "name": "fixture", "private": true }\n');
  write("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
  for (const { folder: name, story, readers } of packages) {
    const manifest = {
      name: `@ws/${name}`,
      ...(story === undefined ? {} : { story }),
      ...(readers === undefined ? {} : { exports: { "./measures": "./src/measures.mjs" }, storytree: { measures: [{ from: "./measures", export: "READERS" }] } }),
    };
    write(`packages/${name}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    if (readers !== undefined) {
      const listed = readers.map(({ measure, version }) => `  { measure: ${JSON.stringify(measure)}, version: ${version}, read() { throw new Error("a reading was taken"); } },`);
      write(`packages/${name}/src/measures.mjs`, `export const READERS = [\n${listed.join("\n")}\n];\n`);
    }
  }
  return folder;
}

/** A measure record's fields, as the library holds them (6.24). */
function measureFields(title: string, story: string, version: number): Record<string, unknown> {
  return { title, description: `${title}, read on the box`, story, reads: `the ${title.toLowerCase()}`, unit: "ms", better: "lower", howRead: "the median of five runs", machine: "the Mint box", runs: 5, version };
}

const ALPHA = "story_a1a1a1a1a1a1";
const BETA = "story_b2b2b2b2b2b2";

/** One story's pairing, its measures each in id order, so the comparison is of what is named, not of the order named. */
function pairingOf(pairings: readonly StoryPairing[], story: string): { paired: string[]; unpaired: Named[] } | undefined {
  const found = pairings.find((one) => one.story === story);
  if (found === undefined) return undefined;
  return {
    paired: [...found.paired].sort(),
    unpaired: found.unpaired.map(({ measure, why, packages }) => ({ measure, why, packages: [...packages].sort() })).sort((a, b) => a.measure.localeCompare(b.measure)),
  };
}

test("2.1 · each measure record pairs with a reader of its id and version in its story's package; a record with no reader, a reader of no live record, a reader of another version, a reader in another story's package and two readers of one measure are each named per story, reading no value", async (t) => {
  const paired = "measure_100000000001"; // Alpha's, version 2, read at version 2 in alpha-tools
  const otherVersion = "measure_100000000002"; // Alpha's, version 3, read at version 1
  const twice = "measure_100000000003"; // Alpha's, read in alpha-tools and in alpha-extra
  const elsewhere = "measure_100000000004"; // Alpha's, read only in beta-kit, a package of Beta
  const betaPaired = "measure_200000000001"; // Beta's, read in beta-kit
  const unread = "measure_200000000002"; // Beta's, read nowhere
  const recordless = "measure_dead00000001"; // read in beta-kit, no live record

  const folder = checkout(t, [
    { folder: "alpha-tools", story: ALPHA, readers: [{ measure: paired, version: 2 }, { measure: otherVersion, version: 1 }, { measure: twice, version: 1 }] },
    { folder: "alpha-extra", story: ALPHA, readers: [{ measure: twice, version: 1 }] },
    { folder: "beta-kit", story: BETA, readers: [{ measure: elsewhere, version: 1 }, { measure: betaPaired, version: 1 }, { measure: recordless, version: 1 }] },
    { folder: "gamma-plain", story: "story_c3c3c3c3c3c3" },
  ]);

  const readers = await seam.measureReadersOf(folder);
  const declared = readers.map(({ package: pkg, story, measure, version }) => ({ package: pkg, story, measure, version })).sort((a, b) => `${a.package} ${a.measure}`.localeCompare(`${b.package} ${b.measure}`));
  assert.deepEqual(declared, [
    { package: "packages/alpha-extra", story: ALPHA, measure: twice, version: 1 },
    { package: "packages/alpha-tools", story: ALPHA, measure: paired, version: 2 },
    { package: "packages/alpha-tools", story: ALPHA, measure: otherVersion, version: 1 },
    { package: "packages/alpha-tools", story: ALPHA, measure: twice, version: 1 },
    { package: "packages/beta-kit", story: BETA, measure: elsewhere, version: 1 },
    { package: "packages/beta-kit", story: BETA, measure: betaPaired, version: 1 },
    { package: "packages/beta-kit", story: BETA, measure: recordless, version: 1 },
  ], "every workspace package's declared readers, each with its package folder and that package's story; a package declaring none adds none");

  const records = [
    { id: paired, fields: measureFields("Cold start", ALPHA, 2) },
    { id: otherVersion, fields: measureFields("Bundle size", ALPHA, 3) },
    { id: twice, fields: measureFields("Parse time", ALPHA, 1) },
    { id: elsewhere, fields: measureFields("Query time", ALPHA, 1) },
    { id: betaPaired, fields: measureFields("Render time", BETA, 1) },
    { id: unread, fields: measureFields("Sync time", BETA, 1) },
  ];
  const pairings = seam.pairMeasures(records, readers);

  assert.deepEqual(pairings.map(({ story }) => story).sort(), [ALPHA, BETA], "one entry for each story with a record or a reader");
  assert.deepEqual(pairingOf(pairings, ALPHA), {
    paired: [paired],
    unpaired: [
      { measure: otherVersion, why: "version", packages: ["packages/alpha-tools"] },
      { measure: twice, why: "two-readers", packages: ["packages/alpha-extra", "packages/alpha-tools"] },
      { measure: elsewhere, why: "wrong-story", packages: ["packages/beta-kit"] },
    ].sort((a, b) => a.measure.localeCompare(b.measure)),
  }, "Alpha's: the one read once at its version paired, and each other named with why and the packages whose readers it names");
  assert.deepEqual(pairingOf(pairings, BETA), {
    paired: [betaPaired],
    unpaired: [
      { measure: unread, why: "no-reader", packages: [] },
      { measure: recordless, why: "no-record", packages: ["packages/beta-kit"] },
    ].sort((a, b) => a.measure.localeCompare(b.measure)),
  }, "Beta's: a record read nowhere, and a reader in its package of no live record");

  const allPaired = seam.pairMeasures(records.filter(({ id }) => id === paired || id === betaPaired), readers.filter(({ measure }) => measure === paired || measure === betaPaired));
  assert.deepEqual([pairingOf(allPaired, ALPHA), pairingOf(allPaired, BETA)], [{ paired: [paired], unpaired: [] }, { paired: [betaPaired], unpaired: [] }], "every record read once, at its version, in its story's package: all paired, none named");
});

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("2.2 · storytree code-measures pair prints each story's measures paired and unpaired with why, is refused naming the count when any does not pair, says so and passes with nothing to pair, and gives the same data with --json", async (t) => {
  const family = CODE_MEASURES_FAMILIES.find((one) => one.name === "code-measures");
  const pair = family?.verbs.find((one) => mounted(one.command) && one.command.name === "pair") as Verb<VerbInputs, VerbContext> | undefined;
  assert.ok(pair !== undefined, "the code-measures family has a pair verb");

  await withLibrary(async (library) => {
    const alpha = await library.addStory({ title: "Alpha tools" });
    const beta = await library.addStory({ title: "Beta kit" });
    const contextIn = (folder: string): VerbContext => ({ folder, project: library.name, session: "s", library });

    const empty = checkout(t, [{ folder: "alpha-tools", story: alpha.id }, { folder: "beta-kit", story: beta.id }]);
    const nothing = await pair.act({ json: false }, contextIn(empty), WORDS);
    assert.match(nothing.text, /nothing to pair/i, "no record and no reader: it says so, and passes");

    const coldStart = await library.writeKnowledge("measure", measureFields("Cold start", alpha.id, 1) as never);
    const bundle = await library.writeKnowledge("measure", measureFields("Bundle size", alpha.id, 1) as never);
    const recordless = "measure_dead00000001";
    const mixed = checkout(t, [
      { folder: "alpha-tools", story: alpha.id, readers: [{ measure: coldStart.id, version: 1 }] },
      { folder: "beta-kit", story: beta.id, readers: [{ measure: recordless, version: 1 }] },
    ]);
    const refused = await pair.act({ json: false }, contextIn(mixed), WORDS).then(
      () => assert.fail("a pairing with measures that do not pair is refused"),
      (error: unknown) => error,
    );
    assert.ok(refused instanceof VerbRefusal, "refused, so the command exits non-zero");
    const lines = refused.message.split(/\r?\n/);
    const lineOf = (words: string) => lines.find((line) => line.includes(words)) ?? "";
    assert.match(refused.message, /Alpha tools/, "it names each story");
    assert.match(refused.message, /Beta kit/);
    assert.match(lineOf("Cold start"), /\bpaired\b/i, "the measure read once, at its version, in its story's package is listed paired");
    assert.doesNotMatch(lineOf("Cold start"), /unpaired|no reader|no record/i);
    assert.match(lineOf("Bundle size"), /no reader/i, "a record no package reads is listed with why");
    assert.match(lineOf(recordless), /no record/i, "a reader of no live record is listed with why");
    assert.match(refused.message, /\b2\b[^\n]*pair/i, "the refusal names how many do not pair");

    const fixed = checkout(t, [
      { folder: "alpha-tools", story: alpha.id, readers: [{ measure: coldStart.id, version: 1 }, { measure: bundle.id, version: 1 }] },
      { folder: "beta-kit", story: beta.id },
    ]);
    const passed = await pair.act({ json: false }, contextIn(fixed), WORDS);
    const passedLine = (words: string) => passed.text.split(/\r?\n/).find((line) => line.includes(words)) ?? "";
    assert.match(passed.text, /Alpha tools/);
    for (const title of ["Cold start", "Bundle size"]) {
      assert.match(passedLine(title), /\bpaired\b/i, `every measure paired: ${title} is listed paired, and it passes`);
      assert.doesNotMatch(passedLine(title), /unpaired|no reader|no record/i);
    }

    const data = await pair.act({ json: true }, contextIn(fixed), WORDS);
    assert.equal(data.raw, true, "--json answers with data to pipe");
    const parsed = JSON.parse(data.text) as StoryPairing[];
    assert.deepEqual(pairingOf(parsed, alpha.id), { paired: [coldStart.id, bundle.id].sort(), unpaired: [] }, "the same pairing as data: Alpha's two measures paired");
  });
});
