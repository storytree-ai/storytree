/**
 * Capability 1 · Front door. A verb's words after `storytree <family> <verb>`: the words it takes in order, and its flags,
 * `--name value` or `--name=value`, each kept in the order given. A verb names the flags that are
 * switches (`--current`), which take no value. After `--`, every word is taken in order.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { Refusal } from "./answer.js";

export class Args {
  readonly words: readonly string[];
  readonly #flags: ReadonlyMap<string, readonly string[]>;
  readonly #cwd: string;

  constructor(words: readonly string[], flags: ReadonlyMap<string, readonly string[]>, cwd: string) {
    this.words = words;
    this.#flags = flags;
    this.#cwd = cwd;
  }

  /** The flags given, by name, in the order first given. */
  get names(): readonly string[] {
    return [...this.#flags.keys()];
  }

  /** Whether flag `name` was given. */
  has(name: string): boolean {
    return this.#flags.has(name);
  }

  /** Flag `name`'s value, the last given, read from a file when it is `@file`; undefined when not given. */
  text(name: string): string | undefined {
    const value = this.#flags.get(name)?.at(-1);
    return value === undefined ? undefined : this.read(value);
  }

  /** Every value given for flag `name`, each read from its file when it is `@file`. */
  texts(name: string): string[] {
    return (this.#flags.get(name) ?? []).map((value) => this.read(value));
  }

  /** Flag `name`'s value, or a refusal saying the verb needs it. */
  need(name: string, usage: string): string {
    const value = this.text(name);
    if (value === undefined) throw new Refusal(`this needs --${name}\nusage: storytree ${usage}`, { code: 2 });
    return value;
  }

  /** The word at `index`, or a refusal naming what is missing. */
  word(index: number, what: string, usage: string): string {
    const word = this.words[index];
    if (word === undefined) throw new Refusal(`this needs ${what}\nusage: storytree ${usage}`, { code: 2 });
    return word;
  }

  /**
   * `value`, or the text of the file it names when it is `@file` (relative to the folder the command
   * runs in), without a leading byte-order mark: PowerShell 5.1's `Set-Content -Encoding utf8` writes one.
   */
  read(value: string): string {
    if (!value.startsWith("@") || value.length === 1) return value;
    const file = path.resolve(this.#cwd, value.slice(1));
    try {
      return readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    } catch (error) {
      throw new Refusal(`cannot read ${file}: ${(error as Error).message}`);
    }
  }
}

/** Parse `tokens`, taking `switches` as flags with no value. */
export function parseArgs(tokens: readonly string[], switches: readonly string[], cwd: string): Args {
  const words: string[] = [];
  const flags = new Map<string, string[]>();
  const add = (name: string, value: string): void => {
    const values = flags.get(name) ?? [];
    values.push(value);
    flags.set(name, values);
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "--") {
      words.push(...tokens.slice(i + 1));
      break;
    }
    if (!token.startsWith("--") || token.length === 2) {
      words.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    if (equals !== -1) {
      add(name, token.slice(equals + 1));
    } else if (switches.includes(name)) {
      add(name, "true");
    } else {
      const value = tokens[i + 1];
      if (value === undefined) throw new Refusal(`--${name} needs a value`, { code: 2 });
      add(name, value);
      i++;
    }
  }
  return new Args(words, flags, cwd);
}

/** Comma-separated ids: refuse a shell-joined word, never infer its intended ids. */
export function commaSeparatedIds(value: string, name: string): string[] {
  const ids = value.split(",").map((one) => one.trim()).filter((one) => one !== "");
  if (ids.some((id) => /\s/.test(id))) {
    throw new Refusal(
      `--${name} contains whitespace inside an id. PowerShell may have converted an unquoted comma list to an array and joined it with spaces. Retry with the whole comma-separated list quoted, for example --${name} "id1,id2" (replace id1 and id2 with your intended ids). No ids were guessed or split on whitespace.`,
      { code: 2 },
    );
  }
  return ids;
}
