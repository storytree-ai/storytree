// Capability 4 · Agent guidance. The generated guidance's rules, which packages/dev-loop/src/build-guidance.mjs runs: how the agent roles in the
// library become 0.3's own CLAUDE.md region, AGENTS.md and role files, how those files are checked
// for drift against the library, and the size budget each is held to (ADR-0636 D1, b5). It ports
// the behaviour of 0.2's `build:guidance` / `build:agents` / `check:guidance` / `check:agents`
// (ADR-0633 D2). Everything here but readRoles, which reads the library through its public API, is pure.
//
// - The role named `session-orchestrator` (by its title, or one of its aliases) is the digest: its
//   one line, role, outcome, workflow and escalation, and the notes it stands on by title. The
//   digest fills the region between CLAUDE.md's markers, which is all of CLAUDE.md that is
//   generated, and the whole of AGENTS.md, which Codex reads as Claude Code reads CLAUDE.md.
// - Every other role becomes a Claude Code subagent (.claude/agents/<name>.md) and a Codex one
//   (.codex/agents/<name>.toml), <name> being its title in kebab case.
// - Every process note with a `skill` name becomes a skill by that name, one SKILL.md that Claude
//   Code reads from .claude/skills/<name>/ and Codex from .agents/skills/<name>/: a procedure run in
//   the conversation with the owner, which a subagent role cannot be, since subagents cannot talk
//   to him. Its description is what both harnesses match a request against, held to 1,024
//   characters because Codex loads no skill with a longer one. A line `{{include <id>}}` in its steps
//   is replaced by that linked pattern's statement, approach and tradeoffs (4.6), so a note another
//   channel is generated from too (voice's instructions, from pattern_5ab3b3241c67) is carried
//   whole rather than cited, and editing it and rebuilding changes the skill.
// - The check judges a branch only on its own drift (4.5): the library is shared, so a role another
//   lane edited there before its pull request lands drifts every branch's committed files. A drifted
//   file fails the branch when the branch changes it, when the session running the check wrote one
//   of the notes it is generated from since the branch forked, when that edit is already on
//   origin/main (merge it), or when its notes cannot be named; otherwise it is printed with the
//   note's last editor and fails nothing.
// - Not ported, since they did not last in 0.2 (ADR-0639; counted 2026-09-27 over 2026-08-15 to
//   2026-09-26): the .cursor, .gemini and .opencode role files. Cursor was retired as a harness
//   (0.2's ADR-0198), Gemini never ran, OpenCode ran once (2026-08-07), and none of the three had a
//   commit of its own in that stretch: each of their 26 was a regeneration riding on .claude/agents.
//
// The budgets are bytes. 0.2's CLAUDE.md reached 918 lines and 128 KB with no budget at all.
// - CLAUDE.md, 40,000: Claude Code warns that a CLAUDE.md past 40,000 characters hurts performance.
// - AGENTS.md, 32,768: Codex reads only that much of an AGENTS.md unless told otherwise
//   (project_doc_max_bytes), and 0.3 does not tell it otherwise.
// - A role file, 36,000: 0.2's cap on a role's prompt (9,000 tokens, at four characters a token).

/** Where CLAUDE.md's generated region starts: the line opening with this. */
export const REGION_START = "<!-- storytree:guidance START";
/** Where it ends: this line. */
export const REGION_END = "<!-- storytree:guidance END -->";
/** The most bytes each file may hold; `role` is each role file's. */
export const BUDGETS = { "CLAUDE.md": 40_000, "AGENTS.md": 32_768, role: 36_000 };
/** The role whose digest is CLAUDE.md's region and AGENTS.md. */
export const ROOT_ROLE = "session-orchestrator";
/** The role files' directories, and the extension each holds. */
export const ROLE_DIRS = { ".claude/agents": ".md", ".codex/agents": ".toml" };
/** The skill directories, Claude Code's then Codex's: each skill is <dir>/<name>/SKILL.md. */
export const SKILL_DIRS = [".claude/skills", ".agents/skills"];
/** The longest skill description Codex loads. */
export const SKILL_DESCRIPTION_MAX = 1024;

const REGENERATE = "Regenerate with `pnpm build:guidance`; `pnpm check:guidance` fails when this file has drifted from the library.";

/**
 * @typedef {{ id: string, fields: Record<string, any> }} Role
 * @typedef {{ root: Role | undefined, others: Role[], skills?: Role[], titles: Map<string, string>, notes?: Map<string, Role> }} Roles
 * @typedef {{ file: string, problem: "missing" | "stale" | "orphan" }} Drift
 */

/**
 * The agent roles a library holds: the root role, the others in name order, the process notes marked
 * as skills in skill-name order, and the title of every live note, for printing the notes a role or
 * a skill links to, and every live note by id, for the patterns a skill includes.
 * @param {{ search(query: string): Promise<{ id: string, type: string, fields: Record<string, any> }[]> }} library
 * @returns {Promise<Roles>}
 */
export async function readRoles(library) {
  const notes = await library.search(""); // every live note: an empty query holds no word to miss
  const titles = new Map(notes.map((note) => [note.id, note.fields.title ?? note.fields.term])); // a definition's title is its term
  const roles = notes.filter((note) => note.type === "agent");
  const isRoot = (role) => nameOf(role) === ROOT_ROLE || (role.fields.aliases ?? []).includes(ROOT_ROLE);
  return {
    root: roles.find(isRoot),
    others: roles.filter((role) => !isRoot(role)).sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    skills: notes
      .filter((note) => note.type === "process" && note.fields.skill !== undefined)
      .sort((a, b) => a.fields.skill.localeCompare(b.fields.skill)),
    titles,
    notes: new Map(notes.map((note) => [note.id, note])),
  };
}

/**
 * Every generated file as it should read, by its path from the repo root: CLAUDE.md (the committed
 * one, `claudeMd`, with its region regenerated), AGENTS.md, each role's two files, then each skill's
 * two copies. A skill whose description Codex would not load is refused, naming it.
 * @param {Roles} roles
 * @param {string} claudeMd
 * @returns {Map<string, string>}
 */
export function expectedFiles(roles, claudeMd) {
  const digest = roles.root === undefined ? noRoot() : digestOf(roles.root, roles.titles);
  const files = new Map([
    ["CLAUDE.md", withRegion(claudeMd, digest)],
    ["AGENTS.md", `<!-- GENERATED from the library's agent roles; do not edit by hand. ${REGENERATE} -->\n\n# storytree 0.3: agent guidance\n\n${digest}\n`],
  ]);
  for (const role of roles.others) {
    const name = nameOf(role);
    const marker = `<!-- GENERATED from the library's "${role.fields.title}" agent role; do not edit by hand. ${REGENERATE} -->`;
    const prompt = promptOf(role, roles.titles);
    const model = role.fields.model === undefined ? "" : `model: ${role.fields.model}\n`;
    const effort = role.fields.effort === undefined ? "" : `effort: ${role.fields.effort}\n`;
    files.set(`.claude/agents/${name}.md`, `---\nname: ${name}\ndescription: ${JSON.stringify(role.fields.oneLine)}\n${model}${effort}---\n\n${marker}\n\n${prompt}\n`);
    files.set(
      `.codex/agents/${name}.toml`,
      `name = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(role.fields.oneLine)}\n` +
        `model_reasoning_effort = "${role.fields.effort ?? (role.fields.model === "opus" ? "high" : "medium")}"\n` +
        `developer_instructions = """\n${tomlMultiline(`${marker}\n\n${prompt}`)}\n"""\n`,
    );
  }
  for (const skill of roles.skills ?? []) {
    const { description, skill: name, title } = skill.fields;
    if (description.length > SKILL_DESCRIPTION_MAX) {
      throw new Error(`the skill "${name}" (${title}) has a description of ${description.length.toLocaleString("en")} characters; Codex loads none over ${SKILL_DESCRIPTION_MAX.toLocaleString("en")}`);
    }
    const marker = `<!-- GENERATED from the library's "${title}" process; do not edit by hand. ${REGENERATE} -->`;
    const text = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${marker}\n\n${skillOf(skill, roles.titles, roles.notes ?? new Map())}\n`;
    for (const dir of SKILL_DIRS) files.set(`${dir}/${name}/SKILL.md`, text);
  }
  return files;
}

/**
 * How the files on disk differ from `expected`, line endings aside: each expected file that is
 * missing or reads differently, then each file in a role directory, and each SKILL.md in a skill
 * directory, that nothing generates.
 * @param {Map<string, string>} expected
 * @param {{ read(file: string): string | undefined, list(dir: string): string[] }} disk
 * @returns {Drift[]}
 */
export function driftOf(expected, disk) {
  /** @type {Drift[]} */
  const drift = [];
  for (const [file, content] of expected) {
    const actual = disk.read(file);
    if (actual === undefined) drift.push({ file, problem: "missing" });
    else if (lf(actual) !== lf(content)) drift.push({ file, problem: "stale" });
  }
  for (const [dir, extension] of Object.entries(ROLE_DIRS)) {
    for (const file of disk.list(dir)) {
      if (file.endsWith(extension) && !expected.has(file)) drift.push({ file, problem: "orphan" });
    }
  }
  for (const dir of SKILL_DIRS) {
    for (const file of disk.list(dir)) {
      if (file.endsWith("/SKILL.md") && !expected.has(file)) drift.push({ file, problem: "orphan" });
    }
  }
  return drift;
}

/**
 * The notes each generated file is made from: its role or skill, then the notes it links, whose
 * titles it prints. An orphan has none, since nothing generates it.
 * @param {Roles} roles
 * @returns {Map<string, string[]>}
 */
export function sourcesOf(roles) {
  const linked = (role) => [role.id, ...["context", "rules", "antiPatterns"].flatMap((key) => role.fields[key] ?? [])];
  const sources = new Map();
  if (roles.root !== undefined) for (const file of ["CLAUDE.md", "AGENTS.md"]) sources.set(file, linked(roles.root));
  for (const role of roles.others) {
    const name = nameOf(role);
    sources.set(`.claude/agents/${name}.md`, linked(role));
    sources.set(`.codex/agents/${name}.toml`, linked(role));
  }
  for (const skill of roles.skills ?? []) {
    const ids = [skill.id, ...(skill.fields.links ?? []), ...(skill.fields.branchEdges ?? []).map((edge) => edge.to)];
    for (const dir of SKILL_DIRS) sources.set(`${dir}/${skill.fields.skill}/SKILL.md`, ids);
  }
  return sources;
}

/**
 * Which drift is the branch's own, each with why, and which another editor's unlanded library edit
 * explains, each with that editor: the latest write to the file's notes.
 * @param {Drift[]} drift
 * @param {{
 *   sources: Map<string, string[]>,
 *   writes: Map<string, { actor?: string, at: string }[]>,
 *   me: string,
 *   since?: string,
 *   branchChanged: Set<string> | undefined,
 *   onMain: Set<string>,
 * }} context `writes` holds each source note's history; `me` is the actor the checking session
 *   writes as; `since`, when the branch forked; `branchChanged`, the files the branch changes, or
 *   undefined when git cannot say; `onMain`, the files origin/main already holds as expected.
 * @returns {{ own: (Drift & { why: string })[], others: (Drift & { editor: { id: string, actor: string, at: string } })[] }}
 */
export function judgeDrift(drift, { sources, writes, me, since, branchChanged, onMain }) {
  const own = [];
  const others = [];
  for (const item of drift) {
    const ids = sources.get(item.file) ?? [];
    const entries = ids.flatMap((id) => (writes.get(id) ?? []).map((entry) => ({ id, actor: entry.actor ?? "writer not recorded", at: entry.at })));
    const editor = entries.sort((a, b) => b.at.localeCompare(a.at))[0];
    let why;
    if (branchChanged === undefined) why = "git could not say what this branch changes";
    else if (branchChanged.has(item.file)) why = "this branch changes it";
    else if (onMain.has(item.file)) why = "the library edit is already on origin/main: merge it";
    else if (ids.length === 0 || editor === undefined) why = "no library note it is made from could be named";
    else if (entries.some((entry) => entry.actor === me && (since === undefined || entry.at >= since))) why = `${me} edited a note it is made from`;
    if (why === undefined) others.push({ ...item, editor });
    else own.push({ ...item, why });
  }
  return { own, others };
}

/**
 * The files holding more bytes than their budget, each with its size and budget.
 * @param {Map<string, string>} files
 * @returns {{ file: string, bytes: number, budget: number }[]}
 */
export function overBudget(files) {
  const over = [];
  for (const [file, content] of files) {
    const budget = BUDGETS[file] ?? BUDGETS.role;
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > budget) over.push({ file, bytes, budget });
  }
  return over;
}

/** A role's file name: its title in kebab case. */
export function nameOf(role) {
  return role.fields.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- rendering -------------------------------------------------------------------------------

function digestOf(role, titles) {
  const { fields } = role;
  return [
    `**${fields.title}.** ${fields.oneLine}`,
    ...paragraphs(fields, ["role", "Role"], ["outcome", "Outcome"], ["workflow", "Workflow"], ["escalation", "Escalation"]),
    standsOn(role, titles),
  ].join("\n\n");
}

function promptOf(role, titles) {
  const { fields } = role;
  return [
    `# ${fields.title}`,
    fields.oneLine,
    ...paragraphs(fields, ["role", "Role"], ["outcome", "Outcome"], ["tools", "Tools"], ["workflow", "Workflow"], ["escalation", "Escalation"]),
    standsOn(role, titles),
  ].join("\n\n");
}

/** A skill's body: the process's own fields as sections, then the notes it links and hands on to. */
function skillOf(skill, titles, notes) {
  const { fields } = skill;
  const sections = [
    ["trigger", "When to use"],
    ["steps", "Steps"],
    ["surfaces", "Surfaces"],
    ["failureModes", "Failure modes"],
    ["verification", "Verification"],
  ].filter(([key]) => fields[key] !== undefined);
  const named = (id) => titleOf(id, skill, titles, "process");
  const links = [
    ...(fields.links ?? []).map((id) => `- ${named(id)}`),
    ...(fields.branchEdges ?? []).map((edge) => `- hands on to ${named(edge.to)}${edge.label === undefined ? "" : `: ${edge.label}`}`),
  ];
  return [
    `# ${fields.title}`,
    fields.statement,
    ...sections.map(([key, label]) => `## ${label}\n\n${key === "steps" ? withIncludes(skill, notes) : fields[key]}`),
    ...(links.length === 0 ? [] : [`## Stands on\n\nNotes in the library; find one by its title with the MCP server's \`search_notes\`.\n\n${links.join("\n")}`]),
  ].join("\n\n");
}

const INCLUDE = /^\{\{include ([a-z]+_[0-9a-f]{12})\}\}$/gm;

/** A skill's steps with each `{{include <id>}}` line replaced by that linked pattern, whole (4.6). */
function withIncludes(skill, notes) {
  return skill.fields.steps.replace(INCLUDE, (_line, id) => {
    const note = notes.get(id);
    if (!(skill.fields.links ?? []).includes(id)) throw new Error(`the process "${skill.fields.title}" includes ${id}, which it does not link`);
    if (note?.type !== "pattern") throw new Error(`the process "${skill.fields.title}" includes ${id}, which is not a live pattern`);
    const { title, statement, approach, tradeoffs } = note.fields;
    return [`**${title}** (${id}, carried whole from the library; change it there).`, statement, approach, ...(tradeoffs === undefined ? [] : [tradeoffs])].join("\n\n");
  });
}

function paragraphs(fields, ...named) {
  return named.filter(([key]) => fields[key] !== undefined).map(([key, label]) => `**${label}.** ${fields[key]}`);
}

/** The notes a role links to, by title, grouped as 0.2 grouped them; their text stays in the library. */
function standsOn(role, titles) {
  const groups = [
    ["context", "Required reading"],
    ["rules", "Rules"],
    ["antiPatterns", "Refuse"],
  ];
  const lines = groups
    .filter(([key]) => (role.fields[key] ?? []).length > 0)
    .map(([key, label]) => `- **${label}:** ${role.fields[key].map((id) => titleOf(id, role, titles)).join(" · ")}`);
  return ["**Stands on:** notes in the library; find one by its title with the MCP server's `search_notes`.", ...lines].join("\n");
}

function titleOf(id, note, titles, kind = "agent role") {
  const title = titles.get(id);
  if (title === undefined) throw new Error(`the ${kind} "${note.fields.title}" links to ${id}, which is not a live note`);
  return title;
}

function noRoot() {
  return (
    `The library holds no \`${ROOT_ROLE}\` agent role yet, so there is no guidance to generate here. ` +
    "What 0.3's own agents are told is the owner's call (ADR-0633 D1): it is written into the library as agent roles and principles, then generated into this file."
  );
}

/** `claudeMd` with its region's contents replaced by `digest`, or an error naming the markers it lacks. */
function withRegion(claudeMd, digest) {
  const text = lf(claudeMd);
  const start = text.indexOf(REGION_START);
  const end = start < 0 ? -1 : text.indexOf(REGION_END, start);
  if (start < 0 || end < 0) {
    throw new Error(`CLAUDE.md has no generated region: it needs a line starting \`${REGION_START}\` and, after it, a line \`${REGION_END}\``);
  }
  const header = `${REGION_START}: generated from the library's \`${ROOT_ROLE}\` agent role; do not edit by hand. ${REGENERATE} -->`;
  return `${text.slice(0, start)}${header}\n\n${digest}\n\n${text.slice(end)}`;
}

/** Text safe inside a TOML multi-line basic string. */
function tomlMultiline(text) {
  return text.replace(/\\/g, "\\\\").replace(/"""/g, '""\\"');
}

function lf(text) {
  return text.replace(/\r\n/g, "\n");
}
