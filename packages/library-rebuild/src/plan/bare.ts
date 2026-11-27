// Capability 17 · The library's commands
import type { Library } from "../index.js";

export async function bareSaid(library: Library, capability: string | undefined, plan: string): Promise<string> {
  if (capability === undefined) return "";
  const part = await library.get(capability);
  if (part?.type !== "capability") return "";
  if ((await library.list("contract")).some(({ fields }) => fields.capability === capability)) return "";
  return ` ${JSON.stringify(part.fields.title)} (${capability}) now has no contracts of its own: plan its own behaviour contract (${plan}), or leave it bare knowingly.`;
}
