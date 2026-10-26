/**
 * Capability 6 · Agent tools (ADR-1035 D2): the MCP server's own mounting code, reading a tool's arguments into a declared
 * verb's input. The schema it reads is the library's; the command line reads a command's words to the same input.
 */
import { VerbRefusal, type InputOf, type VerbInput, type VerbInputs, type Verb, type VerbValue } from "@storytree/library/verbs";

/**
 * A tool's arguments, as its schema checked them, read as the verb's input: a switch not given is false, a `many`
 * input is a list, a count the whole number given, and `fields` an object of strings, or of its values as given when
 * marked json.
 */
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

/**
 * A text input, trimmed unless it is marked verbatim: one that says nothing is refused, unless it is marked blank, as
 * the command line refuses it.
 */
function said(name: string, input: VerbInput, value: string): string {
  const text = value.trim();
  if (text === "" && !(input.kind === "text" && input.blank)) throw new VerbRefusal(`${name} is empty: ${input.describe}`, { misuse: true });
  return input.kind === "text" && input.verbatim ? value : text;
}
