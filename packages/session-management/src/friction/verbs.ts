/**
 * Capability 17 · Friction, its verbs (ADR-1097). The `friction` and `resteer` verbs, declared once here
 * (ADR-0969 D2) and mounted by both front doors: by the command line as its families of those names, 13th and 14th
 * (ADR-1033), and by the MCP server as the tools record_friction, reinforce, friction_drain, route and record_resteer.
 * File friction or a re-steer, add a recurrence, and drain and route the friction a landing's pass judges.
 */
import type { FieldsOf } from "@storytree/library";
import { verb, VerbRefusal, type VerbContext, type VerbFamily } from "@storytree/library/verbs";

/** A field's value as given: JSON for a list, else the text. */
function listOf(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // Not JSON: read it as comma-separated ids.
    }
  }
  return text.split(",").map((id) => id.trim()).filter(Boolean);
}

/** The fields given, each under its camel-cased name, and the links as a list: capture takes only its own fields. */
function fields(given: Readonly<Record<string, string | undefined>>): Record<string, unknown> {
  const named: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(given)) {
    if (value === undefined) continue;
    named[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = name === "links" ? listOf(value) : value;
  }
  return named;
}

/** The branch checked out in `folder`, or "(no branch)". */
async function branchIn(folder: string): Promise<string> {
  const { runGit } = await import("../activity/git.js");
  try {
    return runGit(["branch", "--show-current"], { cwd: folder, timeout: 5_000 }).trim() || "(no branch)";
  } catch {
    return "(no branch)";
  }
}

const frictionNew = verb({
  command: {
    family: "friction",
    name: "new",
    summary: "file friction with concrete evidence and its impact",
    usage: "friction new --title <t> --description … --statement … --evidence <text|@file> --impact … [--links a,b] [--increment <increment>] [--about-storytree] [--none-match]",
  },
  tool: {
    name: "record_friction",
    description: "Record friction: something that got in the way, with concrete evidence (a path, a pull request, a commit, a command and its output, an error, or a quoted excerpt) and what it cost. Record it; do not decide what to do about it. It first shows the closest earlier reports and writes nothing: reinforce the one that is the same problem, or call again with none-match to file it new.",
  },
  inputs: {
    title: { kind: "text", describe: "a short name for it" },
    description: { kind: "text", describe: "one line on what it is" },
    statement: { kind: "text", describe: "what went wrong" },
    evidence: { kind: "text", describe: "the concrete evidence for it" },
    impact: { kind: "text", describe: "what it cost" },
    links: { kind: "text", optional: true, describe: "what it links to, comma-separated" },
    increment: { kind: "text", optional: true, describe: "the increment it happened in, when you were driving one" },
    "about-storytree": { kind: "switch", describe: "it is a defect in storytree itself (its tools, app or guidance), not in this project: the reply carries a draft issue for the user to send storytree's maintainers" },
    "none-match": { kind: "switch", describe: "none of the closest earlier reports filing showed is this problem: file it new" },
  },
  writes: true,
  async act({ "about-storytree": aboutStorytree, "none-match": noneMatch, ...input }, context: VerbContext) {
    const { closestFriction, recordFriction } = await import("./filing/capture.js");
    // A repeat is a recurrence of the earlier report, so the filer sees the closest first (ADR-1233 D1).
    const closest = noneMatch ? [] : await closestFriction(context.library, { title: input.title, statement: input.statement });
    if (closest.length > 0) {
      return {
        text: [
          `Not filed yet. The closest earlier friction reports (open, resolved and dismissed alike):`,
          ...closest.map((one) => `  ${one.id}  ${one.state}, ${one.recurrences} recurrences  ${one.title}`),
          `If one is this problem, add a recurrence to it instead (a resolved or dismissed one reopens): friction reinforce <id> --evidence …. If none is, file it again with --none-match.`,
        ].join("\n"),
        data: { closest },
        next: [
          ...closest.map((one) => ({ command: `friction reinforce ${one.id} --evidence …`, why: `it is the same problem as ${one.title}` })),
          { command: "friction new … --none-match", why: "none of them is this problem" },
        ],
      };
    }
    const note = await recordFriction(context.library, { ...fields(input), branch: await branchIn(context.folder) } as never, context.writer!);
    const next = [{ command: `library read ${note.id}`, why: "read it whole" }];
    if (!aboutStorytree) return { text: `Recorded friction ${note.id}.`, data: { id: note.id }, next };
    // Settled by question_03c165b887c7 (option A): storytree sends nothing; the user reviews the draft and submits it.
    const { issueDraft } = await import("./issue-draft.js");
    const draft = issueDraft({ ...input, project: context.project, folder: context.folder });
    return {
      text: [
        `Recorded friction ${note.id} in this project's library, which storytree's maintainers cannot see.`,
        "It is about storytree, so offer the user this draft issue for its maintainers, showing them its title and text (paths and the project's name are stripped). Only if they agree do they open it, review it on GitHub and submit it themselves; storytree sends nothing:",
        draft,
      ].join("\n"),
      data: { id: note.id, issueDraft: draft },
      next,
    };
  },
});

const reinforce = verb({
  command: { family: "friction", name: "reinforce", summary: "add a dated recurrence on this branch, with its concrete evidence", usage: "friction reinforce <friction> --evidence <text|@file> [--branch <branch>]" },
  tool: {
    name: "reinforce",
    description: "Record a recurrence of existing friction with its own concrete evidence. It appends the date and this session's branch, keeping the original item and its route.",
  },
  inputs: {
    friction: { kind: "text", word: 0, describe: "the friction's id" },
    evidence: { kind: "text", describe: "the concrete evidence of this recurrence" },
    branch: { kind: "text", optional: true, describe: "the branch it recurred on, when not this one" },
  },
  writes: true,
  async act({ friction, evidence, branch }, context: VerbContext) {
    const { reinforceFriction } = await import("./filing/capture.js");
    const note = await reinforceFriction(context.library, friction, { branch: branch ?? await branchIn(context.folder), evidence }, context.writer!);
    return { text: `Reinforced friction ${note.id}.`, data: { id: note.id }, next: [{ command: `library read ${note.id}`, why: "see its recurrences" }] };
  },
});

const drain = verb({
  consumers: ["agent"],
  command: { family: "friction", name: "drain", summary: "the reports a landing's pass routes: up to three from other branches, most recurrences first, each with its lookalikes" },
  tool: {
    name: "friction_drain",
    description: "Drain friction for the landing's pass: up to three open reports other branches filed, most recurrences first, leased to this session for a few minutes, each with its lookalikes from the last four weeks (settled ones too). Read each whole, judge those sharing its root cause as one theme, then route it once, naming the theme.",
  },
  inputs: {},
  // It leases what it lists to the asking session (17.13).
  writes: true,
  async act(_input, context: VerbContext) {
    const { leaseFriction, lookalikes, openFriction } = await import("./drain/drain.js");
    const open = await openFriction(context.library, { branch: await branchIn(context.folder) });
    const { taken: due, free } = await leaseFriction(context.library, open, context.writer === undefined ? {} : { writer: context.writer });
    if (due.length === 0) return { text: "No friction is due: every report from another branch is routed." };
    // Judged together, reports sharing a root cause are routed once as a theme (ADR-1241).
    const alike = await Promise.all(due.map((note) => lookalikes(context.library, note)));
    const lines = due.flatMap((note, index) => [
      `  ${note.id}  (${note.fields.reinforcedBy?.length ?? 0} recurrences)  ${note.fields.title}`,
      ...alike[index]!.map((one) => `      looks like ${one.id}  ${one.state}, ${one.recurrences} recurrences, filed ${one.filed}  ${one.title}`),
    ]);
    const more = free > due.length ? [`${free - due.length} more wait.`] : [];
    return {
      text: [
        `${due.length} friction report${due.length === 1 ? "" : "s"} due for routing, each with its lookalikes from the last four weeks:`,
        ...lines,
        ...more,
        "Judge each with its lookalikes: those sharing its root cause (not merely a similar fix) are one theme, routed once with --theme naming the rest.",
      ].join("\n"),
      data: {
        due: due.map((note) => note.id),
        lookalikes: Object.fromEntries(due.map((note, index) => [note.id, alike[index]])),
        ...(more.length === 0 ? {} : { more: free - due.length }),
      },
      next: [
        { tool: "open", command: "library read <friction>", why: "read one whole before judging it" },
        { tool: "route", command: "friction route <friction> --to … --reason … --theme <lookalike,…>", why: "route a theme sharing one root cause once" },
      ],
    };
  },
});

const routeVerb = verb({
  command: {
    family: "friction",
    name: "route",
    summary: "record a report's route and reason, or stamp the remedy that landed",
    usage: "friction route <friction> --to <adr|tool|principle|guardrail|process|definition|edit-existing|nothing> --reason <text|@file> [--theme a,b] [--discharged-by <pr or decision>]",
  },
  tool: {
    name: "route",
    description: "Record the routing judgement and reason on friction, or add its delivery stamp later. Every route but nothing needs an open increment naming each routed report in remedies, unless the remedy is already stamped as delivered. Name in theme the other reports that share its root cause: the route is recorded on every one.",
  },
  inputs: {
    friction: { kind: "text", word: 0, describe: "the friction's id" },
    to: { kind: "text", describe: "the route: adr, tool, principle, guardrail, process, definition, edit-existing or nothing" },
    reason: { kind: "text", describe: "why that route" },
    theme: { kind: "text", optional: true, describe: "the other reports sharing its root cause, comma-separated: each is routed the same way and linked to it" },
    "discharged-by": { kind: "text", optional: true, describe: "the pull request or decision that discharged it" },
  },
  writes: true,
  async act({ friction, to, reason, theme, "discharged-by": dischargedBy }, context: VerbContext) {
    const { route } = await import("./drain/drain.js");
    const routed = to as NonNullable<FieldsOf<"friction">["route"]>;
    const members = theme === undefined ? [] : listOf(theme).filter((member) => member !== friction);
    const note = await route(context.library, friction, routed, reason, {
      ...context.writer, ...(dischargedBy === undefined ? {} : { dischargedBy }), ...(members.length === 0 ? {} : { theme: members }),
    });
    const text = members.length === 0 ? `Routed ${note.id} to ${routed}.` : `Routed ${note.id} and its theme (${members.join(", ")}) to ${routed}.`;
    return { text, data: { id: note.id, ...(members.length === 0 ? {} : { theme: members }) }, next: [{ command: `library read ${note.id}`, why: "read it back" }] };
  },
});

/** A re-steer's short name, from what the user redirected the session to: its first line, cut to 80 characters. */
function titleOf(redirect: string): string {
  const line = redirect.trim().split("\n")[0]!;
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
}

const resteerNew = verb({
  command: {
    family: "resteer",
    name: "new",
    summary: "file a re-steer with the owner's quoted words, keeping your account apart",
    usage: "resteer new --redirect … --evidence <quote|@file> [--title <t>] [--description …] [--doing …] [--disposition <defect|taste>] [--judged-by <owner|agent>] [--mode <failure-mode>] [--self-report <text|@file>] [--links a,b]",
  },
  tool: {
    name: "record_resteer",
    description: "Record a re-steer: the user (the project's owner) redirected what you were doing. Two fields are needed: redirect (what they redirected you to; statement is taken for it) and evidence (their own words inside double quotation marks; quote is taken for it). The rest is optional: your own account goes in self-report; disposition is taste unless you say defect (which needs its failure mode, no-mast-home when none fits), and judged-by is agent unless the owner said which.",
  },
  inputs: {
    redirect: { kind: "text", optional: true, describe: "what the owner redirected you to" },
    evidence: { kind: "text", optional: true, describe: "their own words, inside double quotation marks" },
    statement: { kind: "text", optional: true, describe: "taken as redirect when redirect is not given" },
    quote: { kind: "text", optional: true, describe: "taken as evidence when evidence is not given" },
    title: { kind: "text", optional: true, describe: "a short name for it; left out, the first line of redirect" },
    description: { kind: "text", optional: true, describe: "one line on what it is; left out, redirect" },
    doing: { kind: "text", optional: true, describe: "what you were doing" },
    disposition: { kind: "text", optional: true, describe: "defect (something went wrong) or taste (a preference); left out, taste" },
    "judged-by": { kind: "text", optional: true, describe: "who judged it a defect or taste: owner only when the owner said so; left out, agent" },
    mode: { kind: "text", optional: true, describe: "a defect's failure mode" },
    "self-report": { kind: "text", optional: true, describe: "your own account of it, kept apart" },
    links: { kind: "text", optional: true, describe: "what it links to, comma-separated" },
  },
  writes: true,
  async act({ "judged-by": judgedBy, statement, quote, ...given }, context: VerbContext) {
    const redirect = given.redirect ?? statement;
    const evidence = given.evidence ?? quote;
    if (redirect === undefined || evidence === undefined) {
      throw new VerbRefusal("A re-steer needs redirect (what the user redirected you to) and evidence (their own words inside double quotation marks); every other field is optional.", { misuse: true });
    }
    const { recordResteer } = await import("./filing/capture.js");
    const note = await recordResteer(context.library, {
      ...fields(given),
      redirect,
      evidence,
      title: given.title ?? titleOf(redirect),
      description: given.description ?? redirect,
      doing: given.doing ?? "not said",
      disposition: given.disposition ?? "taste",
      dispositionBy: judgedBy ?? "agent",
    } as never, context.writer!);
    return { text: `Recorded re-steer ${note.id}.`, data: { id: note.id }, next: [{ command: `library read ${note.id}`, why: "read it whole" }] };
  },
});

/** Session management's friction command families, which its manifest names under `verbs` (ADR-1033), 13th and 14th among `storytree`'s. */
export const FRICTION_FAMILIES: readonly VerbFamily[] = [
  { name: "friction", summary: "file friction with its evidence, add a recurrence, or drain and route it", order: 13, verbs: [frictionNew, reinforce, drain, routeVerb] },
  { name: "resteer", summary: "file a re-steer, with the owner's own words", order: 14, verbs: [resteerNew] },
];

/** Its section of the habits card (ADR-1021, the guidance kind): filing what fought you, and draining what others filed. */
export const frictionGuidance: readonly string[] = [
  "File what fought you: `record_friction` when something got in your way, with concrete evidence (marked about storytree when the defect is storytree's own, so the user can choose to send it on), and `reinforce` the existing item when it happens again, with its own (filing first shows the closest earlier reports: reinforce the one that is the same problem, or file it again marked none-match); `record_resteer` when the owner redirects you, quoting their own words. Before landing, `friction_drain` hands you up to three reports other sessions filed, each with its lookalikes: read each, judge those sharing its root cause as one theme, then `route` it once with its reason, naming the theme.",
];

/** Friction's verbs that are tools, which the MCP server mounts (17.18). */
export const FRICTION_TOOLS = FRICTION_FAMILIES.flatMap((family) => family.verbs);
