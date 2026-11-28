// Capability 8 · Storytree's own test and gate entries.
import { gitArgumentLists, literal } from "./nodes.mjs";

const PLUMBING = new Set(["diff-tree", "diff-index", "diff-files"]);
const PORCELAIN = new Set(["diff", "log"]);
const READS = /^(?:-p|-u|--patch|-U\d*|--unified(?:=\d+)?|--name-status|--numstat|--raw)$/;
const FOLLOWS = /^(?:-M|--find-renames)/;

const keepsAdded = (filter) => filter.includes("A") || (/^[a-z]+$/.test(filter) && !filter.includes("a"));

function unfollowed(list) {
  const at = list.findIndex((element) => PORCELAIN.has(literal(element)) || PLUMBING.has(literal(element)));
  if (at < 0) return undefined;
  const subcommand = literal(list[at]);
  const options = list.slice(at + 1).map(literal).filter((value) => value !== undefined);
  if (options.some((option) => FOLLOWS.test(option))) return undefined;
  if (PORCELAIN.has(subcommand) && !options.includes("--no-renames")) return undefined;
  const filter = options.find((option) => option.startsWith("--diff-filter="))?.slice("--diff-filter=".length);
  const added = filter === undefined ? options.some((option) => READS.test(option)) : keepsAdded(filter);
  return added ? subcommand : undefined;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unfollowed: "reads added lines, added files or file statuses from git {{subcommand}} without following renames (escape_3bdd35178213): a moved file reads as wholly added, " +
        "so all it already had is charged to the move; diff with -M (and keep R in any --diff-filter) so a move is read against its rename source",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        for (const list of gitArgumentLists(node)) {
          const subcommand = unfollowed(list);
          if (subcommand !== undefined) context.report({ node, messageId: "unfollowed", data: { subcommand } });
        }
      },
    };
  },
};
