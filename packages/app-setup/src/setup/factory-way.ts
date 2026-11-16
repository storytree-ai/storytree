/**
 * Capability 8 · Setup check. The factory's way of working, served to a product project's session (ADR-1331 D1, option C):
 * a project whose library names a factory reads that factory's roles (contract 29.2), so its session is handed the
 * factory's session role whole, as its instructions, and the factory's other roles as its agents, the product's own
 * same-titled role winning. Its repository then needs no copy of either.
 */
import { ProjectGoneError, type Library, type Storytree } from "@storytree/library";

/**
 * The titles a session role goes by: the owner's factory's root role (the one his guidance build makes CLAUDE.md of)
 * and the starter pack's, which a user's factory holds.
 */
export const SESSION_ROLE_TITLES: readonly string[] = ["session-orchestrator", "orchestrator"];

/** What a product project's session is handed from its factory: the session role's title and text, and its agents. */
export interface FactoryWay {
  readonly factory: string;
  readonly sessionRole?: { readonly title: string; readonly text: string };
  readonly agents: readonly string[];
}

/**
 * The factory's way of working for `library`'s session, read through the product's own library so its copies win;
 * undefined for a project that names no factory, or whose factory is gone or no longer one (it then reads only its own).
 */
export async function factoryWay(library: Library, storytree: Storytree): Promise<FactoryWay | undefined> {
  const link = await library.factory();
  if (link.kind !== "product") return undefined;
  const opened = await storytree.openProject(link.factory, { create: false }).catch((error: unknown) => {
    if (error instanceof ProjectGoneError) return undefined;
    throw error;
  });
  if (opened === undefined) return undefined;
  try {
    if ((await opened.factory()).kind !== "factory") return undefined;
  } finally {
    await opened.close();
  }
  const roles = (await library.list("agent")).filter((record) => record.type === "agent");
  const titleOf = (record: (typeof roles)[number]): string => String(record.fields.title);
  const session = SESSION_ROLE_TITLES.map((title) => roles.find((record) => titleOf(record) === title)).find((record) => record !== undefined);
  const agents = roles.filter((record) => record !== session).map(titleOf).sort();
  if (session === undefined) return { factory: link.factory, agents };
  return { factory: link.factory, sessionRole: { title: titleOf(session), text: await roleText(library, session.fields as RoleFields) }, agents };
}

interface RoleFields {
  readonly title: string;
  readonly oneLine: string;
  readonly role: string;
  readonly outcome: string;
  readonly workflow: string;
  readonly escalation?: string;
  readonly context: readonly string[];
}

/** A session role as its session reads it: what it is, then its role, outcome, workflow and escalation, and its required reading by title. */
async function roleText(library: Library, role: RoleFields): Promise<string> {
  const titles = await Promise.all(role.context.map(async (id) => ((await library.get(id))?.fields as { readonly title?: unknown } | undefined)?.title));
  const reading = titles.filter((title): title is string => typeof title === "string");
  return [
    `**${role.title}.** ${role.oneLine}`,
    `**Role.** ${role.role}`,
    `**Outcome.** ${role.outcome}`,
    `**Workflow.** ${role.workflow}`,
    ...(role.escalation === undefined ? [] : [`**Escalation.** ${role.escalation}`]),
    ...(reading.length === 0 ? [] : [`**Required reading** (find each by its title with search_notes): ${reading.join(" · ")}`]),
  ].join("\n\n");
}
