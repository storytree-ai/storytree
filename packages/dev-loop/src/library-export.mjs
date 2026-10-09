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
// Where an artifact prints (the story text moved into the library by ADR-0641 D2 step 2): a
// definition whose term starts `Story text: ` prints in a story when its first link that names a
// front cover names one of that story's covers, or of its capabilities'. Other definitions are not story blocks. Its meaning is the block as the file
// writes it, list marker, bold label, line breaks and indentation included, and it prints verbatim.
// - Behind a capability's cover, it prints in that capability's section, after the shelf and
//   before the contracts, in the order the artifacts were written. So an indented item (`  - …`)
//   written first continues the shelf's list. An artifact starting with a line the export makes takes
//   that line's place: `- **Depends on:**` the line it would make from the capability's
//   dependencies, and `**Contracts**` the header of its contracts.
// - Behind the story's cover, an artifact starting with a `## ` heading is a closing section, heading
//   and all, printed after the last capability; any other is an opening block, printed after the
//   description.

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
  // Notes created in the same millisecond tie in creation order, broken by their random ids; the
  // history's sequence is the order they were written.
  /** @type {Map<string, number>} definition id -> where its creation sits in the history */
  const written = new Map();
  for (const entry of await library.history({ types: ["definition"] })) if (entry.action === "created") written.set(entry.recordId, entry.seq);
  const blocks = notes.filter((note) => note.type === "definition" && note.fields.term.startsWith("Story text: "));
  blocks.sort((a, b) => (written.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (written.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  /** @type {Map<string, string[]>} node id -> the texts of the story-text definitions behind its covers, in the order they were written */
  const behind = new Map();
  for (const note of blocks) {
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
