// Capability 8 · Storytree's own test and gate entries.
import { gitArgumentLists, literal } from "./nodes.mjs";

const REMOTE_SUBCOMMANDS = new Set(["clone", "fetch", "pull", "ls-remote", "push"]);
const VALUE_OPTIONS = new Set(["--depth", "-b", "--branch", "-o", "--origin", "--filter", "-j", "--jobs", "--shallow-since", "--shallow-exclude", "--deepen", "--reference", "--separate-git-dir", "--template", "--server-option"]);

function unendedGitArguments(call) {
  return gitArgumentLists(call).map(unended).filter((subcommand) => subcommand !== undefined);
}

function unended(list) {
  const at = list.findIndex((element) => REMOTE_SUBCOMMANDS.has(literal(element)));
  if (at < 0) return undefined;
  for (let index = at + 1; index < list.length; index++) {
    const element = list[index];
    if (!element) continue;
    const value = literal(element);
    if (value === "--" || value === "--end-of-options") return undefined;
    if (VALUE_OPTIONS.has(value)) index++;
    else if (!safeArgument(element)) return literal(list[at]);
  }
  return undefined;
}

function safeArgument(node) {
  if (literal(node) !== undefined) return true;
  if (node.type === "TemplateLiteral") {
    const head = node.quasis[0].value.cooked;
    return head !== "" && !head.startsWith("-");
  }
  if (node.type === "ConditionalExpression") return safeArgument(node.consequent) && safeArgument(node.alternate);
  if (node.type === "SpreadElement") {
    const lists = node.argument.type === "ConditionalExpression" ? [node.argument.consequent, node.argument.alternate] : [node.argument];
    return lists.every((list) => list.type === "ArrayExpression" && list.elements.every((element) => element && safeArgument(element)));
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unended: 'passes an input-built argument to git {{subcommand}} with no "--" before it (CodeQL\'s js/second-order-command-line-injection): ' +
        'a value opening with "-" is read as an option; put "--" before the first input-built argument',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        for (const subcommand of unendedGitArguments(node)) context.report({ node, messageId: "unended", data: { subcommand } });
      },
    };
  },
};
