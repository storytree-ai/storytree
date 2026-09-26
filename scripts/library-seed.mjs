// The seed's rules, which scripts/seed-library.mjs runs: how a story file (stories/*.md) becomes a
// story with its capabilities and contracts in a library, how a run of the story's tests becomes
// each contract's VERIFIED health, and how a decision file (decisions/*.md) becomes a front cover
// of the story or capability it decided. Everything here but syncStory, recordHealth and
// syncDecisions, which write through the library's public API, is pure.
//
// Honesty rules for the verified column: a contract passes only if it has tests and every one of
// them passed. Any failure fails it. A skipped test is not a pass, so a contract with one is not
// passing, and one whose tests were all skipped, or that has none, is not checked. A test file
// that produced no results (its process died before running any test) proves nothing either way:
// the contracts it holds are left not checked, never failed on the strength of a crash.
// Not checked is never written; the column's absence of an entry already reads not-checked.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Who writes the verified health: a run of the story's tests, seen by storytree for itself. */
export const VERIFIED_BY = "storytree test run";

// --- the story file ---------------------------------------------------------------------------

/**
 * @typedef {{ number: string, text: string, title: string }} ParsedContract
 * @typedef {{ number: number, name: string, title: string, description: string | undefined, dependsOn: number[], contracts: ParsedContract[] }} ParsedCapability
 * @typedef {{ title: string, description: string | undefined, capabilities: ParsedCapability[] }} ParsedStory
 */

/**
 * Read a story file: its `# Story: <name>` title and the paragraph under it; each `## N · Name`
 * heading as a capability, with the first paragraph under it as its description, its
 * `**Depends on:**` line as its dependencies, and the numbered items under `**Contracts**` as its
 * contracts, numbered N.M. Capabilities come in the order the file's `Build order:` line gives
 * (heading order without one), which must put every capability after the ones it depends on.
 * Numbers go in titles: `N · Name`, `N.M · <the contract's words>`.
 * @param {string} markdown
 * @returns {ParsedStory}
 */
export function parseStory(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const top = lines.findIndex((line) => line.startsWith("# "));
  if (top < 0) throw new Error("the story file has no `# Story: <name>` title");
  const name = lines[top].replace(/^# (?:Story:\s*)?/, "").trim();
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  // The first paragraph, without its bold lead-in ("**What it is.**").
  const description = paragraphAt(lines, top + 1)?.replace(/^\*\*[^*]+\*\*\s*/, "");

  /** @type {ParsedCapability[]} */
  const capabilities = [];
  lines.forEach((line, index) => {
    const heading = /^## (\d+) · (.+)$/.exec(line);
    if (heading !== null) capabilities.push(capabilityAt(lines, index, Number(heading[1]), heading[2].trim()));
  });
  if (capabilities.length === 0) throw new Error("the story file has no `## N · Name` capability headings");
  const numbers = capabilities.map(({ number }) => number);
  const twice = numbers.find((number, index) => numbers.indexOf(number) !== index);
  if (twice !== undefined) throw new Error(`the story file has two capabilities numbered ${twice}`);

  return { title, description, capabilities: inBuildOrder(capabilities, buildOrderOf(lines)) };
}

/** The capability whose heading is at `lines[at]`: its section runs to the next `##` heading or `---`. */
function capabilityAt(lines, at, number, name) {
  let end = at + 1;
  while (end < lines.length && !/^(## |---)/.test(lines[end])) end++;
  const section = lines.slice(at + 1, end);

  const first = paragraphAt(section, 0);
  const description = first === undefined || /^(- |\*\*)/.test(first) ? undefined : first;

  const dependsLine = section.find((line) => /^- \*\*Depends on:\*\*/.test(line));
  // Only what comes before the first full stop or bracket names dependencies: "3 (links point at
  // 4's records but do not require them)" depends on 3 alone.
  const dependsOn = dependsLine === undefined
    ? []
    : [...dependsLine.replace(/^- \*\*Depends on:\*\*/, "").split(/[.(]/)[0].matchAll(/\d+/g)].map(([digits]) => Number(digits));

  /** @type {ParsedContract[]} */
  const contracts = [];
  const list = section.findIndex((line) => line.startsWith("**Contracts"));
  if (list >= 0) {
    for (let index = list + 1; index < section.length; index++) {
      const line = section[index];
      const item = /^(\d+)\.\s+(.*)$/.exec(line);
      if (item !== null) contracts.push({ number: `${number}.${item[1]}`, text: item[2].trim(), title: "" });
      else if (/^\s+\S/.test(line) && contracts.length > 0) contracts[contracts.length - 1].text += ` ${line.trim()}`;
      else if (contracts.length > 0 || line.trim() !== "") break;
    }
  }
  for (const contract of contracts) contract.title = `${contract.number} · ${contract.text}`;
  return { number, name, title: `${number} · ${name}`, description, dependsOn, contracts };
}

/** The paragraph starting at or after `lines[from]` (blank lines skipped), its lines joined; undefined if none. */
function paragraphAt(lines, from) {
  let index = from;
  while (index < lines.length && lines[index].trim() === "") index++;
  const paragraph = [];
  while (index < lines.length && lines[index].trim() !== "" && !/^(#|---|```)/.test(lines[index])) {
    paragraph.push(lines[index].trim());
    index++;
  }
  return paragraph.length === 0 ? undefined : paragraph.join(" ");
}

/** The capability numbers of the file's `Build order:` line, in the order it gives them; undefined without one. */
function buildOrderOf(lines) {
  const line = lines.find((candidate) => candidate.startsWith("Build order:"));
  if (line === undefined) return undefined;
  const order = [...line.matchAll(/\d+/g)].map(([digits]) => Number(digits));
  return order.filter((number, index) => order.indexOf(number) === index);
}

/** `capabilities` in `order` (any it leaves out after, in heading order), each after every one it depends on. */
function inBuildOrder(capabilities, order) {
  const ordered = order === undefined
    ? [...capabilities]
    : [
        ...order.flatMap((number) => capabilities.filter((capability) => capability.number === number)),
        ...capabilities.filter((capability) => !order.includes(capability.number)),
      ];
  ordered.forEach((capability, position) => {
    for (const dependency of capability.dependsOn) {
      const at = ordered.findIndex((candidate) => candidate.number === dependency);
      if (at < 0) throw new Error(`${capability.title} depends on ${dependency}, which the story does not have`);
      if (at > position) {
        throw new Error(`the build order puts ${capability.title} before ${ordered[at].title}, which it depends on`);
      }
    }
  });
  return ordered;
}

// --- a test run -------------------------------------------------------------------------------

/**
 * @typedef {{ name: string, suites: string[], file: string, status: "passed" | "failed" | "skipped", message?: string }} TestResult
 */

/**
 * Read the output of Node's junit reporter (`node --test --test-reporter=junit`): one result per
 * testcase, with the names of the suites it sits in (outermost first), its file, and whether it
 * passed, failed or was skipped (a todo counts as skipped). A test file whose process died before
 * reporting any test appears as a failed testcase named after the file.
 * @param {string} xml
 * @returns {TestResult[]}
 */
export function parseJunit(xml) {
  /** @type {TestResult[]} */
  const results = [];
  /** @type {string[]} */
  const suites = [];
  /** @type {TestResult | undefined} */
  let open;
  // A tag, with its attributes matched value by value: a value may hold a raw ">".
  const tags = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  for (const [, closing, tag, attributeText, selfClosing] of xml.matchAll(tags)) {
    const attributes = attributesOf(attributeText);
    if (tag === "testsuite") {
      if (closing) suites.pop();
      else if (!selfClosing) suites.push(attributes.name ?? "");
    } else if (tag === "testcase") {
      if (closing) {
        if (open !== undefined) results.push(open);
        open = undefined;
      } else {
        /** @type {TestResult} */
        const result = { name: attributes.name ?? "", suites: [...suites], file: attributes.file ?? "", status: "passed" };
        if (selfClosing) results.push(result);
        else open = result;
      }
    } else if (!closing && open !== undefined && (tag === "failure" || tag === "error")) {
      open.status = "failed";
      if (attributes.message !== undefined) open.message = attributes.message;
    } else if (!closing && open !== undefined && tag === "skipped" && open.status !== "failed") {
      open.status = "skipped";
      if (attributes.message !== undefined) open.message = attributes.message;
    }
  }
  return results;
}

/** A tag's attributes, decoded. */
function attributesOf(text) {
  /** @type {Record<string, string>} */
  const attributes = {};
  for (const [, name, value] of text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attributes[name] = decode(value);
  return attributes;
}

/**
 * An attribute value's text. Node's reporter escapes a quote as `&quot;` and then escapes that
 * `&` again, so after the one XML decoding a quote still reads `&quot;`.
 */
function decode(value) {
  const entities = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  return value
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity) =>
      entity.startsWith("#x") ? String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      : entity.startsWith("#") ? String.fromCodePoint(Number(entity.slice(1)))
      : entities[entity],
    )
    .replaceAll("&quot;", '"');
}

/**
 * The contract numbers a test file names, in itself and in every module it imports by a relative
 * path, transitively, within `root`: each "N.M" at the start of a string. It is how the contracts a
 * crashed file would have tested are known when the file reported nothing. It may find more than
 * the file tests, never fewer, so a crash can only ever leave too much not checked.
 * @param {string} file
 * @param {{ root: string }} options
 * @returns {Set<string>}
 */
export function contractsCoveredBy(file, { root }) {
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
    for (const [, number] of text.matchAll(/["'`](\d+\.\d+)(?=[\s"'`])/g)) numbers.add(number);
    for (const [, specifier] of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = moduleFile(path.resolve(path.dirname(current), specifier));
      if (target !== undefined && !path.relative(root, target).startsWith("..")) queue.push(target);
    }
  }
  return numbers;
}

/** The source file an import names: as written, or its TypeScript twin (`x.js` -> `x.ts`). */
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

/**
 * @typedef {{ number: string, state: "passing" | "failing" | "not-checked", passed: number, failed: number, skipped: number, total: number, note?: string, reason?: string }} Verdict
 */

/**
 * Judge each of `contracts` (their numbers) from a test run's results. A test counts for the
 * contract its outermost numbered name gives ("8.1 …" around "2.1 [cloud-sql] …" is 8.1's).
 * `coverage(file)` gives the contract numbers a test file holds, for a file that produced no
 * results. Returns each contract's verdict, the results that name no contract of the story, and
 * the files that produced no results with the contracts they leave not checked.
 * @param {{ contracts: string[], results: TestResult[], coverage: (file: string) => Set<string>, show?: (file: string) => string }} input
 */
export function judge({ contracts, results, coverage, show = (file) => file }) {
  const known = new Set(contracts);
  /** @type {Map<string, TestResult[]>} */
  const tests = new Map(contracts.map((number) => [number, []]));
  /** @type {TestResult[]} */
  const unmapped = [];
  /** @type {{ file: string, contracts: string[] }[]} */
  const crashedFiles = [];
  /** @type {Map<string, string>} */
  const crashedUnder = new Map();

  for (const result of results) {
    if (isFileResult(result)) {
      if (result.status !== "failed") continue;
      const held = [...coverage(result.file)].filter((number) => known.has(number)).sort(byNumber);
      crashedFiles.push({ file: result.file, contracts: held });
      for (const number of held) if (!crashedUnder.has(number)) crashedUnder.set(number, result.file);
      continue;
    }
    const number = contractOf(result);
    if (number === undefined || !known.has(number)) unmapped.push(result);
    else tests.get(number).push(result);
  }

  /** @type {Map<string, Verdict>} */
  const verdicts = new Map();
  for (const number of contracts) {
    const own = tests.get(number);
    const counts = {
      passed: own.filter(({ status }) => status === "passed").length,
      failed: own.filter(({ status }) => status === "failed").length,
      skipped: own.filter(({ status }) => status === "skipped").length,
      total: own.length,
    };
    const tally = `${counts.passed}/${counts.total} tests passed`;
    const skipReasons = [...new Set(own.filter(({ status }) => status === "skipped").map(({ message }) => message).filter(Boolean))];
    /** @type {Verdict} */
    let verdict;
    if (counts.failed > 0) verdict = { number, state: "failing", ...counts, note: tally };
    else if (crashedUnder.has(number)) {
      verdict = { number, state: "not-checked", ...counts, reason: `${show(crashedUnder.get(number))} produced no results (its process died before running any test)` };
    } else if (counts.total === 0) verdict = { number, state: "not-checked", ...counts, reason: "no tests" };
    else if (counts.skipped > 0) {
      const why = skipReasons.length > 0 ? ` (${skipReasons.join("; ")})` : "";
      verdict = { number, state: "not-checked", ...counts, reason: `${counts.skipped} of ${counts.total} tests skipped${why}` };
    } else verdict = { number, state: "passing", ...counts, note: tally };
    verdicts.set(number, verdict);
  }
  return { verdicts, unmapped, crashedFiles };
}

/** The result Node reports for a test file itself, named after the file, as it does for one that died. */
function isFileResult(result) {
  const name = result.name.replaceAll("\\", "/").toLowerCase();
  const file = result.file.replaceAll("\\", "/").toLowerCase();
  return result.suites.length === 0 && /\.test\.[cm]?[jt]sx?$/.test(name) && file.endsWith(name);
}

/** The contract a test counts for: the number its outermost numbered name starts with. */
function contractOf(result) {
  for (const name of [...result.suites, result.name]) {
    const match = /^(\d+\.\d+)(?:\s|$)/.exec(name);
    if (match !== null) return match[1];
  }
  return undefined;
}

function byNumber(a, b) {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return a1 - b1 || a2 - b2;
}

// --- writing to the library -------------------------------------------------------------------

/**
 * Put `story` into `library` through its public API, idempotently. The story is found by its
 * title, a capability by the number in its title, a contract by its N.M. What is missing is
 * added. What changed is edited in place, keeping its id and so everything recorded against it:
 * the story's description; a capability's title, description or dependencies; a contract's
 * wording, so a reworded contract keeps its health. Numbered capabilities and contracts the file
 * no longer has are retired. A second run over an unchanged file writes nothing.
 * @param {import("@storytree/library").Library} library
 * @param {ParsedStory} story
 * @param {{ source?: string }} [options] what the story was read from, for the reasons kept in history
 */
export async function syncStory(library, story, { source = "the story file" } = {}) {
  const counts = {
    story: "unchanged",
    capabilities: { added: 0, updated: 0, unchanged: 0, retired: 0 },
    contracts: { added: 0, reworded: 0, unchanged: 0, retired: 0 },
  };
  const tree = await library.projectTree();
  const node = tree.stories.find((candidate) => candidate.title === story.title);
  let storyId;
  if (node === undefined) {
    storyId = (await library.addStory({ title: story.title, ...optional("description", story.description) })).id;
    counts.story = "added";
  } else {
    storyId = node.id;
    if ((node.description ?? "") !== (story.description ?? "")) {
      await library.editStory(storyId, { description: story.description || undefined });
      counts.story = "updated";
    }
  }

  const storedCapabilities = byNumberIn(node?.capabilities ?? []);
  /** @type {Map<string, string>} */
  const capabilityIds = new Map();
  /** @type {Map<string, string>} */
  const contractIds = new Map();
  for (const capability of story.capabilities) {
    const key = String(capability.number);
    const dependsOn = capability.dependsOn.map((number) => capabilityIds.get(String(number)));
    const stored = storedCapabilities.get(key);
    let id;
    if (stored === undefined) {
      id = (
        await library.addCapability({
          title: capability.title,
          story: storyId,
          ...optional("description", capability.description),
          ...(dependsOn.length > 0 ? { dependsOn } : {}),
        })
      ).id;
      counts.capabilities.added++;
    } else {
      id = stored.id;
      const edit = {};
      if (stored.title !== capability.title) edit.title = capability.title;
      if ((stored.description ?? "") !== (capability.description ?? "")) edit.description = capability.description || undefined;
      if (stored.dependsOn.join(" ") !== dependsOn.join(" ")) edit.dependsOn = dependsOn;
      if (Object.keys(edit).length > 0) {
        await library.editCapability(id, edit);
        counts.capabilities.updated++;
      } else counts.capabilities.unchanged++;
    }
    capabilityIds.set(key, id);

    const storedContracts = byNumberIn(stored?.contracts ?? []);
    for (const contract of capability.contracts) {
      const old = storedContracts.get(contract.number);
      if (old === undefined) {
        contractIds.set(contract.number, (await library.addContract({ title: contract.title, capability: id })).id);
        counts.contracts.added++;
        continue;
      }
      contractIds.set(contract.number, old.id);
      if (old.title === contract.title) counts.contracts.unchanged++;
      else {
        await library.editContract(old.id, { title: contract.title });
        counts.contracts.reworded++;
      }
    }
    for (const [number, old] of storedContracts) {
      if (capability.contracts.some((contract) => contract.number === number)) continue;
      await library.retire(old.id, `no longer in ${source}`);
      counts.contracts.retired++;
    }
  }
  for (const [number, old] of storedCapabilities) {
    if (story.capabilities.some((capability) => String(capability.number) === number)) continue;
    for (const contract of old.contracts) {
      await library.retire(contract.id, `its capability is no longer in ${source}`);
      counts.contracts.retired++;
    }
    await library.retire(old.id, `no longer in ${source}`);
    counts.capabilities.retired++;
  }
  return { storyId, capabilityIds, contractIds, counts };
}

/** `nodes` by the number their titles start with (`N · ` or `N.M · `); nodes without one are left out. */
function byNumberIn(nodes) {
  return new Map(
    nodes.flatMap((node) => {
      const match = /^(\d+(?:\.\d+)?) · /.exec(node.title);
      return match === null ? [] : [[match[1], node]];
    }),
  );
}

function optional(field, value) {
  return value === undefined || value === "" ? {} : { [field]: value };
}

/**
 * Write each verdict to its contract's VERIFIED column: passing or failing, by the test run, with
 * its tally as the note. A not-checked verdict writes nothing. The reported column is never
 * touched: that is what an agent says, and no agent has spoken here.
 * @param {import("@storytree/library").Library} library
 * @param {Map<string, string>} contractIds contract number -> id
 * @param {Map<string, Verdict>} verdicts
 */
export async function recordHealth(library, contractIds, verdicts) {
  const written = { passing: 0, failing: 0, notChecked: 0 };
  for (const [number, verdict] of verdicts) {
    if (verdict.state === "not-checked") {
      written.notChecked++;
      continue;
    }
    const id = contractIds.get(number);
    if (id === undefined) throw new Error(`there is no contract ${number} in the library to record its health on`);
    await library.recordVerified(id, verdict.state, { by: VERIFIED_BY, ...optional("note", verdict.note) });
    written[verdict.state]++;
  }
  return written;
}

// --- decisions --------------------------------------------------------------------------------

/**
 * @typedef {{ story: string, capability?: number }} Cover
 * @typedef {{ title: string, cover?: Cover, record: string, text: string }} ParsedDecision
 */

/**
 * Read a decision file (decisions/*.md): a decision made for this project, in short form, to be a
 * front cover of one story or capability. It has a `# <title>`; a `- **Front cover of:**` line
 * naming the story file, with `, capability N` for one of that story's capabilities, or starting
 * with `none` for a decision about the whole project, which sits on no shelf (ADR-0631); a
 * `- **Full record:**` line saying where the whole decision is, starting with the record's id
 * (`ADR-0621 in storytree 0.2's decision log`); and the decision in plain words. The text keeps the
 * words' paragraphs, each on one line (a list item on a line of its own, so the first line is
 * what a shelf shows under the title), and ends with the full record line. The record's id is
 * how a later run finds the decision again.
 * @param {string} markdown
 * @returns {ParsedDecision} with no `cover` for a decision on no shelf
 */
export function parseDecision(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const top = lines.findIndex((line) => line.startsWith("# "));
  if (top < 0) throw new Error("the decision file has no `# <title>` line");
  const title = lines[top].slice(2).trim();

  /** @type {Map<string, string>} */
  const fields = new Map();
  /** @type {string[]} */
  const words = [];
  for (const line of lines.slice(top + 1)) {
    const field = /^- \*\*(Front cover of|Full record):\*\*(.*)$/.exec(line);
    if (field === null) words.push(line);
    else if (fields.has(field[1])) throw new Error(`"${title}" has two \`${field[1]}\` lines; a decision has one of each`);
    else fields.set(field[1], field[2].trim());
  }

  const coverLine = fields.get("Front cover of") ?? "";
  const cover = /^(stories\/[^\s,]+\.md)(?:,?\s+capability\s+(\d+))?\.?$/.exec(coverLine);
  if (cover === null && !/^none\b/i.test(coverLine)) {
    throw new Error(
      `"${title}" names no story or capability it is a front cover of: give it a ` +
        "`- **Front cover of:** stories/<name>.md` line, adding `, capability N` for one of the story's capabilities, " +
        "or `none` for a decision about the whole project, which sits on no shelf",
    );
  }
  const full = fields.get("Full record")?.replace(/\.$/, "");
  const record = /^ADR-\d+\b/.exec(full ?? "")?.[0];
  if (full === undefined || record === undefined) {
    throw new Error(`"${title}" does not say where its full record is: give it a \`- **Full record:** ADR-NNNN in …\` line`);
  }
  return {
    title,
    ...(cover === null ? {} : { cover: { story: cover[1], ...(cover[2] === undefined ? {} : { capability: Number(cover[2]) }) } }),
    record,
    text: [...paragraphsOf(words), `Full record: ${full}.`].join("\n\n"),
  };
}

/** The paragraphs of `lines`, each on one line, except that a list item starts a line of its own. */
function paragraphsOf(lines) {
  /** @type {string[]} */
  const paragraphs = [];
  /** @type {string[]} */
  let current = [];
  for (const line of [...lines, ""]) {
    const text = line.trim();
    if (text === "") {
      if (current.length > 0) paragraphs.push(current.join("\n"));
      current = [];
    } else if (current.length > 0 && !/^(?:[-*]|\d+\.)\s/.test(text)) current[current.length - 1] += ` ${text}`;
    else current.push(text);
  }
  return paragraphs;
}

/**
 * File each decision as a front cover of the story or capability it names, through the library's
 * public API, idempotently; a decision with no cover, about the whole project, is filed on no
 * shelf and found by search (ADR-0631). `nodes` maps each story file to its story's id and its
 * capabilities' ids by number, as syncStory gives them.
 *
 * Every decision is placed before any is written: a decision naming a node the stories do not
 * have, or a record filed twice, is refused and nothing is written. A decision is found again by
 * its full record's id, which its text ends with. What is missing is added, and one whose title,
 * words or node changed is edited in place, so a second run over unchanged files writes nothing.
 * A decision this seed filed whose file is gone leaves its shelf and stays in the library: a front
 * cover is never retired, since retiring does not check what links to a record, and everything
 * filed inside it would be stranded. A note the seed did not write is never touched.
 * @param {import("@storytree/library").Library} library
 * @param {ParsedDecision[]} decisions
 * @param {Map<string, { storyId: string, capabilityIds: Map<string, string> }>} nodes story file -> ids
 */
export async function syncDecisions(library, decisions, nodes) {
  const counts = { added: 0, updated: 0, unchanged: 0, offShelf: 0 };
  /** @type {Map<string, string | undefined>} record -> the id of the node it is a front cover of, undefined for none */
  const placed = new Map();
  /** @type {Map<string, string>} record -> the title it was first filed under */
  const titles = new Map();
  for (const { record, title, cover } of decisions) {
    if (titles.has(record)) {
      throw new Error(
        `${record} is filed twice, as "${titles.get(record)}" and as "${title}": ` +
          "a decision is a front cover of one node at most, so give each record one file",
      );
    }
    titles.set(record, title);
    if (cover === undefined) {
      placed.set(record, undefined);
      continue;
    }
    const story = nodes.get(cover.story);
    const nodeId = cover.capability === undefined ? story?.storyId : story?.capabilityIds.get(String(cover.capability));
    if (nodeId === undefined) {
      const where = cover.capability === undefined ? cover.story : `${cover.story}, capability ${cover.capability}`;
      throw new Error(`${record} ("${title}") is a front cover of ${where}, which the story files do not have`);
    }
    placed.set(record, nodeId);
  }

  /** @type {Map<string, import("@storytree/library").Note>} record -> the decision filed for it */
  const filed = new Map();
  for (const note of await library.search("")) {
    const record = note.type === "decision" ? recordOf(note.fields.text) : undefined;
    if (record !== undefined && !filed.has(record)) filed.set(record, note);
  }

  for (const { record, title, text } of decisions) {
    const frontCoverOf = placed.get(record);
    const old = filed.get(record);
    if (old === undefined) {
      await library.recordDecision({ title, text, ...(frontCoverOf === undefined ? {} : { frontCoverOf }) });
      counts.added++;
      continue;
    }
    const edit = {};
    if (old.fields.title !== title) edit.title = title;
    if (old.fields.text !== text) edit.text = text;
    if (old.fields.frontCoverOf !== frontCoverOf) edit.frontCoverOf = frontCoverOf;
    if (Object.keys(edit).length > 0) {
      await library.editNote(old.id, edit);
      counts.updated++;
    } else counts.unchanged++;
  }
  for (const [record, old] of filed) {
    if (placed.has(record) || old.fields.frontCoverOf === undefined) continue;
    await library.editNote(old.id, { frontCoverOf: undefined });
    counts.offShelf++;
  }
  return { counts, placed };
}

/**
 * File each capability's founding book (stub).
 * @param {import("@storytree/library").Library} library
 * @param {{ file: string, story: ParsedStory }[]} stories
 * @param {Map<string, { storyId: string, capabilityIds: Map<string, string> }>} nodes
 * @param {ParsedDecision[]} decisions
 */
export async function syncFoundingBooks(library, stories, nodes, decisions) {
  return { counts: { added: 0, updated: 0, unchanged: 0, offShelf: 0 } };
}

/** The id of the full record a decision's text ends with, as parseDecision writes it; undefined if it has none. */
function recordOf(text) {
  return /^Full record: (ADR-\d+)\b/m.exec(text)?.[1];
}
