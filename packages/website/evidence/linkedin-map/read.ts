// Reads storytree's own map as it grew, from its library (read only) and main's history, for the LinkedIn clip (render.mjs).
// Each stage is the plan as it stood at a recorded moment, with its code as main held it then; each claim is a session's
// mark on a capability from the moment it was taken until it was released, landed, merged or its session ended.
import type { AnnotatedTree, Change, Line } from "@storytree/library";
import { forestScene, sessionColour, storyNodes, type SessionWisp } from "@storytree/forest";
import { workStates } from "@storytree/arc-surface";
import { planAt } from "../../src/saved-growth.js";
import { codeAt } from "../../src/shop-growth.js";
import { publicNotes } from "../../src/tour-snapshot.js";

const time = (value: string) => Date.parse(value);
const HOUR = 3_600_000;
/** A claim nothing recorded the end of is drawn for at most this long. */
const LONGEST_CLAIM = 12 * HOUR;

export async function readGrowth({ repository, branch, slice }: { repository: string; branch: string; slice: number }) {
  const { route, requireApproval, openNamedProject } = await import("@storytree/project-and-caller");
  const { openActivityLog } = await import("@storytree/session-management");
  const { connect } = await import("@storytree/library");
  const routed = route(repository);
  if (routed.status !== "routed") throw new Error(routed.message);
  if (routed.project !== "storytree") throw new Error(`This checkout routes to ${routed.project}, not storytree.`);
  const server = await connect(routed.library);
  let tree: AnnotatedTree, changes: Change[], lines: Line[];
  try {
    await requireApproval(server, routed.project, routed.folder);
    const library = await openNamedProject(server, routed.project, routed.identity);
    const activity = await openActivityLog(server);
    try {
      const [plan, history, log] = await Promise.all([library.projectTree(), library.changesSince(0), activity.since(routed.project, 0)]);
      tree = plan; changes = [...history.changes]; lines = [...log.lines];
    } finally { await activity.close(); }
  } finally { await server.close(); }
  const capturedAt = new Date().toISOString();
  const surveyAt = codeAt(repository, branch);

  // The moments the map grows through: each story's arrival (stories made in the same minute together), and the end of every
  // day of the history, so the code and the parts made that day come in on their day; then the plan as it stands now.
  const created = new Map<string, string>();
  for (const change of changes) if (change.action === "created" && !created.has(change.recordId)) created.set(change.recordId, change.record.createdAt);
  const first = Math.min(...[...created.values()].map(time));
  const moments = new Set<string>();
  for (const story of tree.stories) { const at = created.get(story.id); if (at) moments.add(new Date(Math.floor(time(at) / 60_000) * 60_000 + 59_999).toISOString()); }
  for (let day = Math.ceil(first / (24 * HOUR)) * 24 * HOUR; day < time(capturedAt); day += 24 * HOUR) moments.add(new Date(day - 1).toISOString());
  const own = lines.filter(line => line.project === "storytree");
  const stages = [];
  for (const at of [...moments].sort()) {
    const plan = planAt(tree, changes, at);
    if (plan.stories.length === 0) continue;
    stages.push({ id: at, at, scene: forestScene(plan, changes.filter(c => time(c.record.updatedAt) <= time(at)), workStates(own.filter(l => time(l.at) <= time(at))), await surveyAt(at, plan)) });
  }
  const survey = await surveyAt(capturedAt, tree);
  const scene = forestScene(tree, changes, workStates(own), survey);
  stages.push({ id: "now", at: capturedAt, scene });
  const places = storyNodes(tree, changes, survey).map(({ id, place }) => ({ id, place }));
  return { project: "storytree", capturedAt, scene, places, stages, changes: publicNotes(changes), sessions: claimSlices(tree, own, first, time(capturedAt), slice) };
}

/** Every claim, as a span: a session's capability from its claim until its release, landing, the merge of the branch it was
 * claimed on, or its session's end, whichever came first (at most LONGEST_CLAIM when none was recorded). */
export function claimSpans(lines: readonly Line[]): { session: string; capability: string; from: number; to: number }[] {
  type Open = { capability: string; from: number; branch?: string };
  const open = new Map<string, Open[]>(), spans: { session: string; capability: string; from: number; to: number }[] = [];
  const end = (session: string, at: number, which: (claim: Open) => boolean) => {
    const held = open.get(session) ?? [];
    for (const claim of held.filter(which)) spans.push({ session, capability: claim.capability, from: claim.from, to: Math.min(at, claim.from + LONGEST_CLAIM) });
    open.set(session, held.filter(claim => !which(claim)));
  };
  for (const line of [...lines].sort((a, b) => a.seq - b.seq) as readonly (Line & Record<string, unknown>)[]) {
    const at = time(line.at), capability = line.capability as string | undefined;
    if (line.kind === "claimed" && capability && line.session) {
      end(line.session, at, claim => claim.capability === capability);
      open.set(line.session, [...(open.get(line.session) ?? []), { capability, from: at, ...(typeof line.branch === "string" ? { branch: line.branch } : {}) }]);
    } else if ((line.kind === "released" || line.kind === "landed") && capability && line.session) end(line.session, at, claim => claim.capability === capability);
    else if ((line.kind === "session-ended" || line.kind === "closed-out") && line.session) end(line.session, at, () => true);
    else if (line.kind === "merged" && typeof line.holder === "string") end(line.holder, at, claim => claim.branch === undefined || claim.branch === line.branch);
  }
  for (const [session, held] of open) for (const claim of held) spans.push({ session, capability: claim.capability, from: claim.from, to: claim.from + LONGEST_CLAIM });
  return spans;
}

/** The claims as a time-lapse: for each `slice` of hours from `from` to `to`, every claim held at any moment inside it, as the
 * app's wisps (one per session and island), so a claim held for minutes still shows for its slice. */
function claimSlices(tree: AnnotatedTree, lines: readonly Line[], from: number, to: number, slice: number) {
  const owner = new Map(tree.stories.flatMap(story => story.capabilities.map(capability => [capability.id, story.id] as const)));
  const spans = claimSpans(lines).filter(span => owner.has(span.capability));
  const out: { at: string; wisps: SessionWisp[] }[] = [];
  for (let at = from; at < to; at += slice * HOUR) {
    const held = new Map<string, Map<string, string[]>>();
    for (const span of spans) {
      if (span.to < at || span.from >= at + slice * HOUR) continue;
      const story = owner.get(span.capability)!, mine = held.get(span.session) ?? new Map<string, string[]>();
      held.set(span.session, mine);
      const parts = mine.get(story) ?? [];
      if (!parts.includes(span.capability)) mine.set(story, [...parts, span.capability]);
    }
    out.push({ at: new Date(at).toISOString(), wisps: [...held].flatMap(([session, stories]) => [...stories].map(([story, capabilities]) =>
      ({ session, story, colour: sessionColour(session), faded: false, capabilities }))) });
  }
  out.push({ at: new Date(to).toISOString(), wisps: [] });
  return out;
}
