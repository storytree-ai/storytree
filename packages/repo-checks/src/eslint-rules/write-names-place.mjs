// Capability 8 · Storytree's own test and gate entries.
import { fileURLToPath } from "node:url";

import { literal } from "./nodes.mjs";

const PLACES = ["project", "arc", "increment"];
const PLACE_FLAGS = new Set(PLACES.map((place) => `--${place}`));
const CLI_MANIFEST = fileURLToPath(new URL("../../../cli/package.json", import.meta.url));

async function composedVerbs() {
  const { composeParts, standIn } = await import("@storytree/plugin-loader");
  const base = await composeParts(CLI_MANIFEST, "verbs");
  try {
    const { readStandIns } = await import("@storytree/project-and-caller");
    return standIn(base, "verbs", readStandIns());
  } catch {
    return base;
  }
}

async function loadWrites() {
  const writes = new Map();
  try {
    const record = (verb, spelled) => {
      if (verb.writes && !verb.callerless && "family" in verb.command) writes.set(spelled, PLACES.some((place) => verb.inputs[place] !== undefined && !verb.inputs[place].optional));
    };
    const walk = (family) => {
      for (const verb of family.verbs) record(verb, `${verb.command.family} ${verb.command.name}`);
      if (family.bare !== undefined) record(family.bare, family.bare.command.family);
      for (const nested of family.families ?? []) walk(nested);
    };
    (await composedVerbs()).parts.forEach(walk);
  } catch {
    return new Map();
  }
  return writes;
}

const WRITES = await loadWrites();

function writeOf(elements) {
  const words = [];
  for (const element of elements) {
    const word = literal(element);
    if (word === undefined) break;
    words.push(word);
  }
  let at = 0;
  if (words[at] === "-s") at++;
  if (words[at] === "storytree") at++;
  for (let end = words.length; end > at; end--) {
    const spelled = words.slice(at, end).join(" ");
    if (WRITES.has(spelled)) return spelled;
  }
  return undefined;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unplaced: 'runs the write "storytree {{command}}" naming no place: a write naming none of "--project", "--arc" or "--increment" is refused (ADR-1348 D3, escape_d6cd4011df60); pass one of them',
    },
  },
  create(context) {
    return {
      ArrayExpression(node) {
        const command = writeOf(node.elements);
        if (command === undefined || WRITES.get(command)) return;
        if (node.elements.some((element) => PLACE_FLAGS.has(literal(element)) || literal(element) === "--help")) return;
        context.report({ node, messageId: "unplaced", data: { command } });
      },
    };
  },
};
