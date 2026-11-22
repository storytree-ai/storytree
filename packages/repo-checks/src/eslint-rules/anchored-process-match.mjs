// Capability 8 · Storytree's own test and gate entries.
import { literal, methodOf, readsCmdline, regexOf, repoFile, unchained } from "./nodes.mjs";

const SCOPE = /^(?:packages|apps)\//;
const TEST_FILE = /\.test\.[^/]+$/;
const MATCHES = new Set(["test", "exec"]);
const SPAWNS = new Set(["execFile", "execFileSync", "spawn", "spawnSync"]);
const MATCHERS = new Set(["pgrep", "pkill"]);
const FULL_MATCH = /^-[A-Za-eg-z]*f[A-Za-z]*$/;

const head = (node) => literal(node) ?? (node?.type === "TemplateLiteral" ? node.quasis[0].value.cooked : undefined);

function commandLine(subject) {
  const node = unchained(subject);
  if (node === undefined) return false;
  if (node.type === "MemberExpression" && !node.computed && node.property.name === "args") return true;
  return readsCmdline(node);
}

function unanchoredRegex(call) {
  if (!MATCHES.has(methodOf(call))) return false;
  const regex = regexOf(unchained(call.callee).object);
  return regex !== undefined && !regex.source.startsWith("^") && commandLine(call.arguments[0]);
}

function unanchoredFullMatch(call) {
  const callee = unchained(call.callee);
  const name = callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;
  if (!SPAWNS.has(name) || !MATCHERS.has(literal(call.arguments[0])) || call.arguments[1]?.type !== "ArrayExpression") return false;
  const list = call.arguments[1].elements;
  const at = list.findIndex((element) => FULL_MATCH.test(literal(element) ?? ""));
  return at >= 0 && head(list[at + 1])?.startsWith("^") !== true;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unanchored: "matches a process command line with a pattern not anchored at its start, so a caller whose own command line holds the text " +
        "(a shell that greps ps for it, an ssh command) matches too (escape_24ab852d292f): anchor the match to the executable from the start of the line " +
        "with ^, or exclude the caller's own process tree",
    },
  },
  create(context) {
    const file = repoFile(context);
    if (!SCOPE.test(file) || TEST_FILE.test(file)) return {};
    return {
      CallExpression(node) {
        if (unanchoredRegex(node) || unanchoredFullMatch(node)) context.report({ node, messageId: "unanchored" });
      },
    };
  },
};
