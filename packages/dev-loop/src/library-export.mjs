// Capability 5 · Library tools. The export's rules, which packages/dev-loop/src/export-library.mjs runs: how a project in a library prints as
// story files (stories/*.md) and decision files (decisions/*.md), in the layout the repo's files had
// before the library became the one copy of 0.3's own stories and decisions (ADR-0641 D2 step 4,
// choice F1). The printout is a read-only copy; nothing is ever read back from it. The export only
// reads the library, through its public API.
//
// A story prints in this layout:
// - `# Story: <title>`, then `**What it is.** <description>`;
// - its opening artifacts, then `---`;
// - each capability in the tree's order: `## N · Name`, its description, its `- **Depends on:**`
//   line, its shelf (`- **Its shelf,** founding book first:` with one item per front cover, the
//   founding book first), its artifacts, then `**Contracts:**` and each contract, numbered;
// - its closing artifacts, after a `---`.
// A capability's founding book (a decision whose text ends `Founding book of stories/<name>.md,
// capability N.`) prints as its shelf's `**Founding book (label):**` item. A decision with a full
// record prints as a decision file of its own, named after the record (decisions/adr-0621.md), and
// as a pointer on its node's shelf.
//
// Where the prose prints (ADR-1050 D1: a story's and a capability's prose is its own `text`, as markdown):
// - A story's text, up to its first `## ` heading, prints after its description; from that heading on, its closing
//   sections print after the last capability.
// - A capability's text prints in its section, after the shelf and before the contracts. A text starting with a list
//   item continues the shelf's list. Two lines the export makes are taken from the text when it has them: a first
//   line `- **Depends on:** …` (with the indented lines that continue it) takes the place of the one it would make
//   from the capability's dependencies, and a last paragraph `**Contracts** …` the header of its contracts.

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

  /** @type {Map<string, string>} node id -> its prose */
  const prose = new Map();
  for (const kind of ["story", "capability"]) for (const record of await library.list(kind)) if (record.fields.text !== undefined) prose.set(record.id, record.fields.text);

  /** @type {Map<string, string>} */
  const files = new Map();
  for (const story of tree.stories) {
    files.set(where.get(story.id).file, await printStory(library, story, prose));
  }
  for (const note of notes) {
    if (note.type !== "decision" || foundingBookOf(note.fields.text) !== undefined) continue;
    const record = recordOf(note.fields.text);
    const name = record === undefined ? storyName(note.fields.title) : record.toLowerCase();
    files.set(`decisions/${name}.md`, printDecision(note, where.get(note.fields.frontCoverOf)));
  }
  return files;
}

async function printStory(library, story, prose) {
  const text = prose.get(story.id) ?? "";
  const heading = /(?:^|\n\n)## /.exec(text);
  const opening = heading === null ? text : text.slice(0, heading.index);
  const closing = heading === null ? "" : text.slice(heading.index).replace(/^\n\n/, "");
  /** @type {string[]} blocks, each printed with a blank line after it */
  const out = [`# Story: ${story.title.charAt(0).toLowerCase()}${story.title.slice(1)}`];
  if (story.description !== undefined) out.push(`**What it is.** ${story.description}`);
  if (opening !== "") out.push(opening);
  out.push("---");

  const numbers = new Map(story.capabilities.map((capability) => [capability.id, numberOf(capability.title)]));
  for (const capability of story.capabilities) {
    out.push(`## ${capability.title}`);
    if (capability.description !== undefined) out.push(capability.description);
    let own = prose.get(capability.id) ?? "";
    const dependsLine = /^- \*\*Depends on:\*\*.*(?:\n[ \t]+(?!- )\S.*)*/.exec(own)?.[0];
    if (dependsLine !== undefined) own = own.slice(dependsLine.length);
    const contractsLine = /(?:^|\n\n)(\*\*Contracts\*\*[^\n]*)$/.exec(own);
    if (contractsLine !== null) own = own.slice(0, contractsLine.index);
    const on = capability.dependsOn.map((id) => numbers.get(id));
    /** @type {string[]} the section's list, printed as one block */
    const list = [dependsLine ?? `- **Depends on:** ${on.length === 0 ? "nothing in this story" : listed(on)}.`];
    const covers = await library.frontCovers(capability.id);
    if (covers.length > 0) {
      list.push("- **Its shelf,** founding book first:");
      for (const cover of covers) list.push(`  - ${shelfItem(cover)}`);
    }
    // The text continues the list when it starts with a list item, and stands apart otherwise.
    const rest = own.replace(/^\n\n/, "").replace(/^\n/, "");
    const continues = rest !== "" && (dependsLine === undefined ? /^\s*- /.test(rest) : !own.startsWith("\n\n"));
    if (continues) list.push(rest);
    out.push(list.join("\n"));
    if (rest !== "" && !continues) out.push(rest);
    if (capability.contracts.length > 0) {
      out.push([contractsLine?.[1] ?? "**Contracts:**", ...capability.contracts.map((contract) => `${numberOf(contract.title).split(".")[1]}. ${contract.title.replace(/^[\d.]+ · /, "")}`)].join("\n"));
    }
  }
  if (closing !== "") out.push("---", closing);
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

/** A story's file name from its title: "Session management" -> "session-management". */
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
