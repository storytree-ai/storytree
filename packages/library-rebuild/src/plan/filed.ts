// Capability 17 · The library's commands
import type { Library } from "../index.js";
import type { SchemaRecord } from "../storage/rules/index.js";

type Part = SchemaRecord<"story" | "capability">;

function sentence(text: string | undefined): string {
  if (text === undefined || text.trim() === "") return "no description written.";
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

export async function filedOnSaid(library: Library, partId: string, correction: string): Promise<string> {
  const part = await library.get(partId);
  if (part === null || (part.type !== "story" && part.type !== "capability")) return "";
  const contracts = await library.list("contract");
  const capabilities = new Map((await library.list("capability")).map((capability) => [capability.id, capability]));
  const said = (one: Part, relation: string) => {
    const titles = contracts.filter(({ fields }) => fields.capability === one.id).map(({ fields }) => JSON.stringify(fields.title));
    const held = titles.length === 0 ? "It has no contracts." : `It has contracts ${titles.join(", ")}.`;
    return `${JSON.stringify(one.fields.title)} (${one.id})${relation}: ${sentence(one.fields.description)} ${held}`;
  };
  const edges = part.type === "capability" ? await library.list("edge") : [];
  const around = [
    ...edges.filter(({ fields }) => fields.to === part.id).flatMap(({ fields }) => capabilities.get(fields.from) ?? []).map((one) => said(one, ", which depends on it")),
    ...edges.filter(({ fields }) => fields.from === part.id).flatMap(({ fields }) => capabilities.get(fields.to) ?? []).map((one) => said(one, ", which it depends on")),
  ];
  return [`It is filed on ${said(part as Part, "")}`, ...around, `If this decision belongs on another part, correct it with ${correction}.`].join("\n");
}
