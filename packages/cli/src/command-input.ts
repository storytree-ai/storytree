// Capability 13 · Reading a command
import { fieldValue, mounted, VerbRefusal, type InputOf, type Verb, type VerbInput, type VerbInputs, type VerbValue } from "@storytree/library/verbs";

export function commandUsage(declared: Verb<VerbInputs, never>): string {
  if (!mounted(declared.command)) throw new Error(`${mounted(declared.tool) ? declared.tool.name : "this verb"} has no command: ${declared.command.absent}`);
  if (declared.command.usage !== undefined) return declared.command.usage;
  const entries = Object.entries(declared.inputs);
  const words = entries.flatMap(([name, input]) => input.kind === "text" && input.word !== undefined ? [[input.word, spelt(input, `<${name}>`)] as const] : []).sort(([a], [b]) => a - b).map(([, word]) => word);
  const flags = entries.flatMap(([name, input]) => {
    if (input.kind === "switch") return [`[--${name}]`];
    if (input.kind === "yes-no") return [`--${name} yes|no`];
    if (input.kind === "fields") return ["--<field> <value> …"];
    if (input.kind === "count") return [input.optional ? `[--${name} <n>]` : `--${name} <n>`];
    return input.word !== undefined ? [] : [spelt(input, `--${name} <${name}>`)];
  });
  const { family, name } = declared.command;
  return [family, ...(name === family ? [] : [name]), ...words, ...flags].join(" ");
}

function spelt(input: VerbInput & { kind: "text" }, place: string): string {
  const many = input.many ? `${place} …` : place;
  return input.optional ? `[${many}]` : many;
}

export interface CommandGiven {
  word(index: number): string | undefined;
  flag(name: string): string | undefined;
  flags(name: string): readonly string[];
  has(name: string): boolean;
  names(): readonly string[];
}

export function commandInput(declared: Verb<VerbInputs, never>, given: CommandGiven): InputOf<VerbInputs> {
  const inputs = Object.entries(declared.inputs);
  if (!inputs.some(([, one]) => one.kind === "fields")) {
    const stray = given.names().find((name) => !inputs.some(([declaredName, one]) => declaredName === name && (one.kind !== "text" || one.word === undefined)));
    if (stray !== undefined) throw new VerbRefusal(`--${stray} is not a flag this takes`, { misuse: true });
  }
  if (!inputs.some(([, one]) => one.kind === "text" && one.many && one.word !== undefined)) {
    const words = Math.max(0, ...inputs.map(([, one]) => one.kind === "text" && one.word !== undefined ? one.word + 1 : 0));
    const count = wordsFrom(given, 0).length;
    if (count > words) throw new VerbRefusal(words === 0 ? "this takes no words" : `this takes ${words === 1 ? "one word" : `${words} words`}, and was given ${count}`, { misuse: true });
  }
  const input: Record<string, VerbValue> = {};
  for (const [name, one] of inputs) {
    if (one.kind === "fields") {
      const named = new Set(Object.keys(declared.inputs));
      input[name] = Object.fromEntries(given.names().filter((field) => !named.has(field)).map((field) => [field, one.json ? fieldValue(given.flag(field)!) : given.flag(field)!]));
    } else if (one.kind === "text" && one.many) {
      const values = one.word === undefined ? given.flags(name) : wordsFrom(given, one.word);
      if (values.length === 0 && !one.optional) throw new VerbRefusal(`this needs ${one.word === undefined ? `--${name}` : `<${name}>`}: ${one.describe}`, { misuse: true });
      input[name] = values.map((value) => said(name, one, value));
    } else if (one.kind === "switch") {
      input[name] = given.has(name);
    } else if (one.kind === "yes-no") {
      const value = given.flag(name);
      if (value === undefined) throw new VerbRefusal(`this needs --${name} yes|no`, { misuse: true });
      if (value !== "yes" && value !== "no") throw new VerbRefusal(`--${name} is yes or no, not ${JSON.stringify(value)}`, { misuse: true });
      input[name] = value === "yes";
    } else if (one.kind === "count") {
      const value = given.flag(name)?.trim();
      if (value === undefined && one.optional) input[name] = undefined;
      else if (value === undefined) throw new VerbRefusal(`this needs --${name}: ${one.describe}`, { misuse: true });
      else if (!/^[1-9]\d*$/.test(value)) throw new VerbRefusal(`--${name} is a whole number above 0, not ${JSON.stringify(value)}`, { misuse: true });
      else input[name] = Number(value);
    } else {
      const value = one.word === undefined ? given.flag(name) : given.word(one.word);
      if (value === undefined && one.optional) input[name] = undefined;
      else if (value === undefined) throw new VerbRefusal(`this needs ${one.word === undefined ? `--${name}` : `<${name}>`}: ${one.describe}`, { misuse: true });
      else input[name] = said(name, one, value);
    }
  }
  return input;
}

function wordsFrom(given: CommandGiven, index: number): string[] {
  const words: string[] = [];
  for (let at = index; given.word(at) !== undefined; at++) words.push(given.word(at)!);
  return words;
}

function said(name: string, input: VerbInput, value: string): string {
  const text = value.trim();
  if (text === "" && !(input.kind === "text" && input.blank)) throw new VerbRefusal(`${name} is empty: ${input.describe}`, { misuse: true });
  return input.kind === "text" && input.verbatim ? value : text;
}
