/** Capability 1 · Front door. A thin front door onto the keys story (ADR-0843): save, list and remove the keys storytree keeps. */
import { Refusal } from "../answer.js";
import type { Family } from "../door.js";

export const auth: Family = {
  name: "auth",
  summary: "save, list or remove a key you give storytree",
  verbs: [{
    name: "set",
    usage: "auth set <name>   (the key, or !<command> that prints it, on standard input)",
    summary: "save a key, read from standard input and never echoed",
    async act(args) {
      if (args.words.length !== 1 || args.names.length) {
        throw new Refusal("usage: storytree auth set <name>, with the key on standard input (never as an argument, which shells keep in their history)", { code: 2 });
      }
      const name = args.word(0, "a key name", "auth set <name>");
      const { authFile, saveKey } = await import("@storytree/keys");
      saveKey(name, (await readSecret(`Key for ${name}: `)).trim());
      return { text: `Saved key ${name} in ${authFile()}.`, next: [{ command: "storytree auth list", why: "the keys storytree has" }] };
    },
  }, {
    name: "list",
    usage: "auth list",
    summary: "name each key and where it resolves from, never its value",
    async act(args) {
      if (args.words.length || args.names.length) throw new Refusal("usage: storytree auth list", { code: 2 });
      const { listKeys } = await import("@storytree/keys");
      const keys = listKeys();
      if (!keys.length) return { text: "No keys saved.", next: [{ command: "storytree auth set <name>", why: "save one" }] };
      const said = { file: "from the file", command: "from its command, run when needed", environment: "from the environment" } as const;
      return { text: keys.map((key) => `${key.name}: ${said[key.from]}${key.variable === undefined ? "" : ` (${key.variable})`}`).join("\n") };
    },
  }, {
    name: "remove",
    usage: "auth remove <name>",
    summary: "delete a saved key",
    async act(args) {
      if (args.words.length !== 1 || args.names.length) throw new Refusal("usage: storytree auth remove <name>", { code: 2 });
      const name = args.word(0, "a key name", "auth remove <name>");
      const { removeKey } = await import("@storytree/keys");
      if (!removeKey(name)) throw new Refusal(`No key ${name} is saved.`, { next: [{ command: "storytree auth list", why: "the keys storytree has" }] });
      return { text: `Removed key ${name}.` };
    },
  }],
};

/** Standard input whole, or one line typed at a terminal with nothing shown. */
async function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    let text = "";
    for await (const chunk of input) text += String(chunk);
    return text;
  }
  process.stderr.write(prompt);
  input.setRawMode(true);
  input.setEncoding("utf8");
  try {
    return await new Promise<string>((resolve, reject) => {
      let typed = "";
      const onData = (chunk: string): void => {
        for (const char of chunk) {
          if (char === "\r" || char === "\n" || char === "\u0004") return done(() => resolve(typed));
          if (char === "\u0003") return done(() => reject(new Refusal("Cancelled: no key saved.")));
          typed = char === "\u007f" || char === "\b" ? typed.slice(0, -1) : typed + char;
        }
      };
      const done = (finish: () => void): void => {
        input.off("data", onData);
        process.stderr.write("\n");
        finish();
      };
      input.on("data", onData);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
  }
}
