// Capability 6 · Tool server (the MCP server)
import { VerbRefusal, type InputOf, type VerbInput, type VerbInputs, type Verb, type VerbValue } from "@storytree/library/verbs";

export function toolInput(declared: Verb<VerbInputs, never>, args: Readonly<Record<string, unknown>>): InputOf<VerbInputs> {
  const input: Record<string, VerbValue> = {};
  for (const [name, one] of Object.entries(declared.inputs)) {
    const value = args[name];
    if (one.kind === "fields") input[name] = Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).map(([field, given]) => [field, one.json ? given : String(given)]));
    else if (one.kind === "count") {
      if (value === undefined && !one.optional) throw new VerbRefusal(`this needs ${name}: ${one.describe}`, { misuse: true });
      input[name] = value as number | undefined;
    } else if (one.kind !== "text") input[name] = value === true;
    else if (one.many) {
      const values = value === undefined ? [] : (value as readonly unknown[]).map(String);
      if (values.length === 0 && !one.optional) throw new VerbRefusal(`this needs ${name}: ${one.describe}`, { misuse: true });
      input[name] = values.map((given) => said(name, one, given));
    } else input[name] = value === undefined && one.optional ? undefined : said(name, one, String(value));
  }
  return input;
}

function said(name: string, input: VerbInput, value: string): string {
  const text = value.trim();
  if (text === "" && !(input.kind === "text" && input.blank)) throw new VerbRefusal(`${name} is empty: ${input.describe}`, { misuse: true });
  return input.kind === "text" && input.verbatim ? value : text;
}
