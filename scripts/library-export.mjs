// The export's rules, which scripts/export-library.mjs runs: how a project in a library prints back
// as the repo's story files (stories/*.md) and decision files (decisions/*.md), and how the
// round-trip check compares that printout with the committed files (ADR-0641 D2 step 1). The
// export only reads the library, through its public API; the check is pure.
//
// A story prints in the layout its file has today:
// - `# Story: <title>`, then `**What it is.** <description>`;
// - its opening artifacts, then `---`;
// - each capability in the tree's order: `## N · Name`, its description, its `- **Depends on:**`
//   line, its shelf (`- **Its shelf,** founding book first:` with one item per front cover, the
//   founding book first), its artifacts, then `**Contracts:**` and each contract, numbered;
// - its closing artifacts, after a `---`.
// A capability's founding book, which the seed files from the story, prints as its shelf's
// `**Founding book (label):**` item. A decision with a full record prints as a decision file of its
// own, named after the record (decisions/adr-0621.md), and as a pointer on its node's shelf.
//
// Where an artifact prints (so that the story text moved into the library, ADR-0641 D2 step 2, prints
// back in its place): a definition whose term starts `Story text: ` prints in a story when
// its first link that names a front cover names one of that story's covers, or of its
// capabilities'. Other definitions are not story blocks. Its meaning is the block as the file
// writes it, list marker, bold label, line breaks and indentation included, and it prints verbatim.
// - Behind a capability's cover, it prints in that capability's section, after the shelf and
//   before the contracts, in the order the artifacts were written. So an indented item (`  - …`)
//   written first continues the shelf's list. An artifact starting with a line the export makes takes
//   that line's place: `- **Depends on:**` the line it would make from the capability's
//   dependencies, and `**Contracts**` the header of its contracts.
// - Behind the story's cover, an artifact starting with a `## ` heading is a closing section, heading
//   and all, printed after the last capability; any other is an opening block, printed after the
//   description.
//
// The round trip splits each file into blocks (a heading, a paragraph, a list item, a nested list
// item, a fenced block; `---` is layout and is skipped), each under the heading it follows, with
// its whitespace collapsed. For each committed file it lists the blocks the printout lacks in the
// same section ("missing": the text only the file holds) and those the printout adds ("extra").
// The order of blocks within a section is not compared. A decision file is paired with its
// printout by its full record, and a story file by its title line, since the library does not keep
// file names (stories/cli.md holds "the command line"); a printed story path is then read as the
// committed one wherever a printout names it, as a decision's cover line does.

// --- the export ------------------------------------------------------------------------------

/**
 * Print the project `library` holds as files, reading only.
 * @param {import("@storytree/library").Library} library
 * @returns {Promise<Map<string, string>>} repo path (`stories/app.md`) -> markdown
 */
export async function exportLibrary(library) {
  const tree = await library.projectTree();
  const notes = await library.search(""); // every live note, in creation order

  /** @type {Map<string, { file: string, number?: string }>} node id -> where it prints */
  const where = new Map();
  for (const story of tree.stories) {
    const file = `stories/${storyName(story.title)}.md`;
    where.set(story.id, { file });
    for (const capability of story.capabilities) where.set(capability.id, { file, number: numberOf(capability.title) });
  }

  /** @type {Map<string, string>} cover id -> the node it is a front cover of */
  const coverOf = new Map();
  for (const note of notes) if (note.type === "decision" && note.fields.frontCoverOf !== undefined) coverOf.set(note.id, note.fields.frontCoverOf);
  /** @type {Map<string, string[]>} node id -> the texts of the story-text definitions behind its covers, in creation order */
  const behind = new Map();
  for (const note of notes) {
    if (note.type !== "definition" || !note.fields.term.startsWith("Story text: ")) continue;
    const cover = note.fields.links?.find((id) => coverOf.has(id));
    if (cover === undefined) continue;
    const node = coverOf.get(cover);
    behind.set(node, [...(behind.get(node) ?? []), note.fields.meaning]);
  }

  /** @type {Map<string, string>} */
  const files = new Map();
  for (const story of tree.stories) {
    files.set(where.get(story.id).file, await printStory(library, story, behind));
  }
  for (const note of notes) {
    if (note.type !== "decision" || foundingBookOf(note.fields.text) !== undefined) continue;
    const record = recordOf(note.fields.text);
    const name = record === undefined ? storyName(note.fields.title) : record.toLowerCase();
    files.set(`decisions/${name}.md`, printDecision(note, where.get(note.fields.frontCoverOf)));
  }
  return files;
}

async function printStory(library, story, behind) {
  const notes = behind.get(story.id) ?? [];
  const closing = notes.filter((text) => text.startsWith("## "));
  /** @type {string[]} blocks, each printed with a blank line after it */
  const out = [`# Story: ${story.title.charAt(0).toLowerCase()}${story.title.slice(1)}`];
  if (story.description !== undefined) out.push(`**What it is.** ${story.description}`);
  out.push(...notes.filter((text) => !closing.includes(text)), "---");

  const numbers = new Map(story.capabilities.map((capability) => [capability.id, numberOf(capability.title)]));
  for (const capability of story.capabilities) {
    out.push(`## ${capability.title}`);
    if (capability.description !== undefined) out.push(capability.description);
    const all = behind.get(capability.id) ?? [];
    const dependsLine = all.find((text) => text.startsWith("- **Depends on:**"));
    const contractsLine = all.find((text) => text.startsWith("**Contracts**"));
    const own = all.filter((text) => text !== dependsLine && text !== contractsLine);
    const on = capability.dependsOn.map((id) => numbers.get(id));
    /** @type {string[]} the section's list, printed as one block */
    const list = [dependsLine ?? `- **Depends on:** ${on.length === 0 ? "nothing in this story" : listed(on)}.`];
    const covers = await library.frontCovers(capability.id);
    if (covers.length > 0) {
      list.push("- **Its shelf,** founding book first:");
      for (const cover of covers) list.push(`  - ${shelfItem(cover)}`);
    }
    // An artifact that is a list item continues the list; any other stands apart, and the list starts again after it.
    for (const text of own) {
      if (/^\s*- /.test(text)) list.push(text);
      else {
        if (list.length > 0) out.push(list.splice(0).join("\n"));
        out.push(text);
      }
    }
    if (list.length > 0) out.push(list.join("\n"));
    if (capability.contracts.length > 0) {
      out.push([contractsLine ?? "**Contracts:**", ...capability.contracts.map((contract) => `${numberOf(contract.title).split(".")[1]}. ${contract.title.replace(/^[\d.]+ · /, "")}`)].join("\n"));
    }
  }
  if (closing.length > 0) out.push("---", ...closing);
  return `${out.join("\n\n")}\n`;
}

/** A front cover as its shelf lists it: the founding book whole, any other decision by its title and record. */
function shelfItem(cover) {
  const book = foundingBookOf(cover.fields.text);
  if (book !== undefined) {
    const label = /: founding book(?: \((.*)\))?$/.exec(cover.fields.title)?.[1];
    return `**Founding book${label === undefined ? "" : ` (${label})`}:** ${book}`;
  }
  const record = recordOf(cover.fields.text);
  return `${cover.fields.title}${record === undefined ? "" : ` (${record}, decisions/${record.toLowerCase()}.md)`}.`;
}

function printDecision(note, node) {
  const paragraphs = note.fields.text.split("\n\n");
  const full = /^Full record: (.*?)\.?$/.exec(paragraphs.at(-1) ?? "")?.[1];
  if (full !== undefined) paragraphs.pop();
  const cover = node === undefined ? "none" : node.number === undefined ? node.file : `${node.file}, capability ${node.number}`;
  const fields = [`- **Front cover of:** ${cover}`, ...(full === undefined ? [] : [`- **Full record:** ${full}`])];
  return `${[`# ${note.fields.title}`, fields.join("\n"), ...paragraphs].join("\n\n")}\n`;
}

/** The book of a founding-book decision the seed filed, without its identity line; undefined for any other decision. */
function foundingBookOf(text) {
  const match = /^([\s\S]*)\n\nFounding book of stories\/\S+\.md, capability \d+\.$/.exec(text);
  return match?.[1];
}

/** The id of the full record a decision's text ends with; undefined if it has none. */
function recordOf(text) {
  return /^Full record: (ADR-\d+)\b/m.exec(text)?.[1];
}

/** A story's file name from its title: "The agent link" -> "agent-link". */
function storyName(title) {
  return title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The number a node's title starts with: "3 · Surfaces" -> "3", "3.4 · …" -> "3.4". */
function numberOf(title) {
  return /^(\d+(?:\.\d+)?) · /.exec(title)?.[1] ?? "";
}

/** "1", "1 and 2", "1, 2 and 5". */
function listed(items) {
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// --- the round trip ---------------------------------------------------------------------------

/**
 * @typedef {{ section: string, text: string, raw: string, words: number }} Block
 * @typedef {{ file: string, printedAs?: string, missing: Block[], extra: Block[] }} FileDiff
 */

/**
 * Compare the committed files with the printout, section by section. Each committed file comes
 * back, in the order given, with the blocks only it holds and those only its printout holds; a
 * printed file no committed file pairs with comes back after them, all of it extra.
 * @param {Map<string, string>} committed repo path -> markdown
 * @param {Map<string, string>} printed repo path -> markdown, as exportLibrary gives it
 * @returns {FileDiff[]}
 */
export function roundTrip(committed, printed) {
  const recordOfFile = (text) => /^- \*\*Full record:\*\* (ADR-\d+)\b/m.exec(text)?.[1];
  /** @type {Map<string, string>} record -> printed path */
  const printedByRecord = new Map();
  for (const [file, text] of printed) {
    const record = file.startsWith("decisions/") ? recordOfFile(text) : undefined;
    if (record !== undefined) printedByRecord.set(record, file);
  }
  const titleOf = (text) => /^# Story: (.*)$/m.exec(text)?.[1].trim().toLowerCase();
  /** @type {Map<string, string>} story title -> printed path, since the library does not keep file names either */
  const printedByTitle = new Map();
  for (const [file, text] of printed) {
    const title = file.startsWith("stories/") ? titleOf(text) : undefined;
    if (title !== undefined) printedByTitle.set(title, file);
  }
  const printedAsOf = (file, text) => {
    const record = file.startsWith("decisions/") ? recordOfFile(text) : undefined;
    const title = file.startsWith("stories/") ? titleOf(text) : undefined;
    return record !== undefined ? printedByRecord.get(record) : (title !== undefined && printedByTitle.get(title)) || (printed.has(file) ? file : undefined);
  };
  /** @type {[string, string][]} printed story path -> the committed one it pairs with, where they differ */
  const renamed = [...committed]
    .filter(([file]) => file.startsWith("stories/"))
    .map(([file, text]) => [printedAsOf(file, text), file])
    .filter(([printedAs, file]) => printedAs !== undefined && printedAs !== file);
  /** A printout with each renamed story's printed path read as its committed one, as a decision's cover line names it. */
  const underCommittedNames = (text) => renamed.reduce((out, [printedAs, file]) => out.split(printedAs).join(file), text);
  const paired = new Set();
  /** @type {FileDiff[]} */
  const diffs = [];
  for (const [file, text] of committed) {
    const printedAs = printedAsOf(file, text);
    if (printedAs !== undefined) paired.add(printedAs);
    const [missing, extra] = compare(blocksOf(text), blocksOf(printedAs === undefined ? "" : underCommittedNames(printed.get(printedAs))));
    diffs.push({ file, ...(printedAs === undefined ? {} : { printedAs }), missing, extra });
  }
  for (const [file, text] of printed) {
    if (!paired.has(file)) diffs.push({ file, printedAs: file, missing: [], extra: blocksOf(text) });
  }
  return diffs;
}

/** The blocks of `a` that `b` lacks in the same section, and those of `b` that `a` lacks, each in its own order. */
function compare(a, b) {
  const key = ({ section, text }) => `${section}\n${text}`;
  const without = (blocks, others) => {
    const counts = new Map();
    for (const block of others) counts.set(key(block), (counts.get(key(block)) ?? 0) + 1);
    return blocks.filter((block) => {
      const left = counts.get(key(block)) ?? 0;
      if (left > 0) counts.set(key(block), left - 1);
      return left === 0;
    });
  };
  return [without(a, b), without(b, a)];
}

/**
 * The blocks of a markdown file, each under the last heading before it.
 * @param {string} markdown
 * @returns {Block[]}
 */
export function blocksOf(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  /** @type {Block[]} */
  const blocks = [];
  let section = "";
  const item = /^(\s*)(?:[-*]|\d+\.)\s/;
  const push = (rawLines, verbatim = false) => {
    const raw = rawLines.join("\n");
    const nested = item.exec(rawLines[0])?.[1].length > 0;
    const text = verbatim ? rawLines.map((line) => line.trimEnd()).join("\n") : `${nested ? "  " : ""}${raw.replace(/\s+/g, " ").trim()}`;
    blocks.push({ section, text, raw, words: raw.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0 });
  };
  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    if (line.trim() === "" || /^---+\s*$/.test(line)) {
      index++;
    } else if (/^```/.test(line)) {
      let end = index + 1;
      while (end < lines.length && !/^```/.test(lines[end])) end++;
      push(lines.slice(index, end + 1), true);
      index = end + 1;
    } else if (/^#{1,6} /.test(line)) {
      section = line.trim();
      push([line]);
      index++;
    } else if (item.test(line)) {
      const indent = item.exec(line)[1].length;
      let end = index + 1;
      while (end < lines.length && lines[end].trim() !== "" && !item.test(lines[end]) && /^\s/.test(lines[end]) && lines[end].search(/\S/) > indent) end++;
      push(lines.slice(index, end));
      index = end;
    } else {
      let end = index + 1;
      while (end < lines.length && lines[end].trim() !== "" && !/^(#{1,6} |```|---+\s*$)/.test(lines[end]) && !item.test(lines[end])) end++;
      push(lines.slice(index, end));
      index = end;
    }
  }
  return blocks;
}
