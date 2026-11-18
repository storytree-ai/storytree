// Capability 8 · Setup check.
import { ProjectGoneError, type Library, type Storytree } from "@storytree/library";

export const SESSION_ROLE_TITLES: readonly string[] = ["session-orchestrator", "orchestrator"];

export interface FactoryWay {
  readonly factory: string;
  readonly sessionRole?: { readonly title: string; readonly text: string };
  readonly agents: readonly string[];
}

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
