/** Capability 1 · Front door. Thin front door onto app-setup's bundled helper; it owns delivery paths and connection results. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Refusal } from "../answer.js";
import type { Context, Verb } from "../door.js";

function installed(args: string[], context: Context) {
  const script = context.script === undefined ? undefined : path.join(path.dirname(context.script), "storytree-deliver.mjs");
  if (script === undefined || !existsSync(script)) throw new Refusal(`The installed setup helper is missing: only an installed storytree has it. Re-run the storytree installer, then run this installation's storytree setup ${args[0] === "open-uninstaller" ? "uninstall" : "connect"} command.`);
  const ran = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  if (ran.status !== 0) throw new Refusal(`${ran.stderr ?? ""}${ran.stdout ?? ""}`.trim() || "The connection helper could not run. Re-run the storytree installer and retry.", { code: ran.status ?? 1 });
  return { text: ran.stdout };
}

export const setupConnectionVerbs: readonly Verb[] = [
  {
    name: "connect", usage: "setup connect [--claude] [--codex] [--cursor]", summary: "connect the installed tools to your chosen agents; hooks are checked in their next session",
    switches: ["claude", "codex", "cursor"],
    async act(args, context) {
      if (args.words.length || !args.names.length || args.names.some((name) => !["claude", "codex", "cursor"].includes(name) || args.text(name) !== "true")) {
        throw new Refusal("Choose --claude, --codex, --cursor or several. usage: storytree setup connect [--claude] [--codex] [--cursor]", { code: 2 });
      }
      const answer = installed(["connect", ...(args.has("claude") ? ["claude-code"] : []), ...(args.has("codex") ? ["codex"] : []), ...(args.has("cursor") ? ["cursor"] : [])], context);
      await context.journey?.().then((journey) => journey.agentConnected()).catch(() => {});
      return answer;
    },
  },
  {
    name: "disconnect", usage: "setup disconnect <claude-code|codex|cursor>", summary: "disconnect one agent while keeping other connections and your projects",
    async act(args, context) {
      const harness = args.words[0];
      if (args.names.length || args.words.length !== 1 || (harness !== "claude-code" && harness !== "codex" && harness !== "cursor")) {
        throw new Refusal("usage: storytree setup disconnect <claude-code|codex|cursor>", { code: 2 });
      }
      return installed(["disconnect", harness], context);
    },
  },
  {
    name: "uninstall", usage: "setup uninstall [--keep-library|--remove-library]",
    summary: "remove storytree from this computer, as Windows Apps & features does; your project folders are left alone",
    switches: ["keep-library", "remove-library"],
    async act(args, context) {
      const keep = args.has("keep-library");
      const remove = args.has("remove-library");
      if (args.words.length || (keep && remove) || args.names.some((name) => !["keep-library", "remove-library"].includes(name) || args.text(name) !== "true")) {
        throw new Refusal("usage: storytree setup uninstall [--keep-library|--remove-library] (without either, the uninstaller asks)", { code: 2 });
      }
      return installed(["open-uninstaller", ...(keep ? ["keep"] : remove ? ["remove"] : [])], context);
    },
  },
];
