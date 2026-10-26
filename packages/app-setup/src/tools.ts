/**
 * Capability 12 · Import an existing project, with capability 11 · Pipeline wiring and capability 6 · Make a folder a project:
 * App setup's tools on the MCP server's one server, named in its manifest (ADR-1021), so switching App setup off takes
 * them with it (ADR-1095): `take_starter_pack` and `move_onto_factory` (6), `wire_pipeline` (11, ADR-0911 D3) and
 * `import_project` (12). `check_setup` and `set_up_project` stay the server's own (ADR-1099 D2): they answer in a folder that is not
 * a project yet, where no part serves. The extension's shape is restated rather than imported, as quality assurance's
 * is: no story may depend on the MCP server, which depends on this package to serve the tools, and checks the two still
 * fit where it mounts its tool parts (its 6.75).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Library, Storytree } from "@storytree/library";
import { z } from "zod";

import { ghProtection, githubRepository, importFetches, protectionCommand, storytreeRef, WORKFLOW_FILE, workflowFor, type ImportFetch, type PipelineJob, type ProtectionReader, type System } from "./pipeline/pipeline.js";
import { moveOntoFactory } from "./project/factory-move.js";
import { ImportRefusedError, importLines, importProject } from "./project/importing.js";
import { STARTER_CHECKS, STARTER_ROLES, takeStarterPack } from "./project/starter-pack.js";

/** What a tool has for one call, of what the server hands it. */
interface ToolCall {
  readonly library: Library;
  readonly storytree: Storytree;
  readonly project: string;
  /** The folder the agent works in. */
  readonly folder: string;
}

/** What a tool answers. */
interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
  readonly refused?: boolean;
}

/** Registers one tool: its name, what it is for, its arguments and what it does with them. */
type Define = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>) => void;

/** App setup's contribution to the MCP server's one tool server. */
export interface ToolExtension {
  readonly registerTools?: (define: Define) => void;
}

/**
 * What the part is given: how wire_pipeline reads whether a repository's plan allows branch protection, when not through
 * `gh`, and the pipeline jobs the parts the host mounts contribute (ADR-1170 D2), none when it gives none.
 */
export interface ToolHost {
  readonly protection?: ProtectionReader;
  readonly pipelineJobs?: readonly PipelineJob[];
}

/** App setup's tool part, named in its manifest (ADR-1021): served for every project's library. */
export const setupToolParts = [(host: ToolHost): ToolExtension => setupTools(host.protection, host.pipelineJobs)];

/** A title, quoted as the tools quote names. */
function quoted(title: string): string {
  return `"${title}"`;
}

/** The tools App setup serves. */
export function setupTools(readProtection: ProtectionReader = ghProtection, jobs: readonly PipelineJob[] = []): ToolExtension {
  return {
    registerTools(define) {
      define(
        "take_starter_pack",
        `Take the newer starter pack into this project's library, or into the factory it reads its system from: call it only when check_setup offered it and the user said yes, or when the user asks for a part a new project starts without, named in include. It adds the records the library lacks and replaces only the ones the user has not edited; each edited one is left as it is and named, with the newer text beside it. A new project starts on the bare bones, with no role, check or note; its parts are the roles ${STARTER_ROLES.join(", ")}, the review checks ${STARTER_CHECKS.join(", ")}, and any note one of them links, each coming with the notes it links.`,
        z.object({
          include: z.array(z.string()).optional().describe("Parts of the starter pack to take in by title, only those the user asked for"),
        }),
        async ({ include }, { library, storytree }) => {
          const took = await takeStarterPack(library, storytree, include);
          const into = took.factory === undefined ? "" : ` into the factory ${quoted(took.factory)}, which this project reads its system from`;
          const said = [`Took the starter pack${into}: added ${took.added.length} and replaced ${took.replaced.length} of its records.`];
          if (took.kept.length > 0) {
            said.push(`Left as the user edited ${took.kept.length === 1 ? "it" : "them"}: ${took.kept.map(({ kind, title }) => `the ${kind} ${quoted(title)}`).join(", ")}. Show the user the newer text beside each (in this answer's data) and change one only if they ask.`);
          }
          return { text: said.join(" "), data: { ...took } };
        },
      );
      define(
        "move_onto_factory",
        "Move this project onto the user's factory, the project holding the system their projects build with (ADR-1040): call it only when the user said yes. Each copy of a role, note or check this project never edited, and the factory also holds, is dropped so the factory's shows through; every one the user edited or added stays this project's own. Moving again changes nothing.",
        z.object({}),
        async (_args, { storytree, project }) => {
          const moved = await moveOntoFactory({ storytree, project });
          const said = [`This project now builds with the factory "${moved.factory}": dropped ${moved.dropped.length} unedited ${moved.dropped.length === 1 ? "copy" : "copies"} of its system.`];
          if (moved.kept.length > 0) said.push(`Kept as this project's own: ${moved.kept.map(({ kind, title, why }) => `the ${kind} ${quoted(title)}${why === "own" ? "" : ` (${why})`}`).join(", ")}.`);
          return { text: said.join(" "), data: { ...moved } };
        },
      );
      define(
        "import_project",
        "Import an existing JavaScript or TypeScript project into this storytree project, when the user asks: its folder is recorded as imported, and each package it declares becomes a mapped story, with no capabilities. Importing again adds new packages and drops gone ones, and says the commit recorded before and now, the files changed between them, and any explored capability whose files are gone, which it leaves for an agent to reshape. Nothing is written into the folder.",
        z.object({ folder: z.string().min(1).describe("The folder of the project to import, absolute or relative to this project's folder") }),
        async ({ folder }, { library, storytree, folder: here }) => {
          const imported = await importProject({ folder: path.resolve(here, folder), library, storytree }).catch((error: unknown) => {
            if (error instanceof ImportRefusedError) return error;
            throw error;
          });
          if (imported instanceof ImportRefusedError) return { text: imported.message, refused: true };
          const added = imported.added.map((story) => `${quoted(story.title)} (${story.id})`).join(", ");
          return {
            text: [`Imported ${imported.folder}: ${imported.added.length} mapped stories added${added === "" ? "" : `: ${added}`}; ${imported.retired.length} retired, their package gone; ${imported.kept.length} kept as they stand.`, ...importLines(imported)].join("\n"),
            data: {
              folder: imported.folder,
              added: imported.added.map((story) => story.id),
              retired: imported.retired,
              kept: imported.kept,
              ...(imported.commit === undefined ? {} : { commit: imported.commit }),
              ...(imported.before === undefined ? {} : { before: imported.before }),
              ...(imported.changes === undefined ? {} : { changes: imported.changes }),
              stranded: imported.stranded,
            },
          };
        },
      );
      define(
        "wire_pipeline",
        "When this project is set up or adopts a pipeline, add its tests and storytree's checks to its CI: on GitHub this writes storytree's workflow, elsewhere it gives the commands to add. It proposes branch protection for the user to approve and never turns it on.",
        z.object({
          test: z.string().min(1).describe("The command that runs the project's tests, as its CI should run it"),
          install: z.string().min(1).optional().describe("The command that installs its dependencies first, if any"),
          systems: z.array(z.enum(["linux", "macos", "windows"] satisfies System[])).min(1).optional().describe("The systems the user chose to test on; linux when not given"),
        }),
        async ({ test, install, systems = ["linux"] as System[] }, { folder, storytree, library }) => {
          const ref = storytreeRef();
          const repository = githubRepository(folder);
          const imports = await importFetches({ storytree, project: library.name, folder });
          const fetches = imports.flatMap((imported) => ("commands" in imported ? imported.commands : []));
          const said = importsSaid(imports);
          const checks = jobs.map((job) => job.name);
          if (repository === undefined) {
            const commands = [...fetches, ...(install === undefined ? [] : [install]), test, ...jobs.flatMap((job) => job.commands(ref, "<this checkout>"))];
            return {
              text: [
                `This project is not on GitHub, so nothing was written. Add these commands to the pipeline you have, run on every change before it merges${checks.length === 0 ? "" : ` (Node 24 for ${checks.join(" and ")}, with a temporary folder in RUNNER_TEMP)`}:`,
                ...commands.map((command) => `  ${command}`),
                ...said,
                "Then propose to the user that their host merge only what this pipeline verified: it is a repository setting, theirs to approve.",
              ].join("\n"),
              data: { written: false, commands, imports, protection: { approved: false } },
            };
          }
          const file = path.join(folder, WORKFLOW_FILE);
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, workflowFor({ install, test, systems, ref, fetches, jobs }));
          const wrote = [
            `Wrote storytree's workflow to ${WORKFLOW_FILE}: on every pull request and push to main it runs \`${test}\` on ${systems.join(", ")}${checks.length === 0 ? "" : `, and ${checks.join(" and ")} from storytree's source at ${ref}`}. Commit it on a branch and open a pull request: its first run is the proof.`,
            ...said,
          ].join("\n");
          if ((await readProtection(folder, repository)) === "refused by plan") {
            return {
              text: [
                wrote,
                `This repository cannot have branch protection: GitHub refuses it on this repository's plan (HTTP 403, a private repository on a free account), so propose no protection command. Offer the user the honest alternative instead: merge only after every check passes (the tests${checks.map((check) => ` and ${check}`).join("")}), which you keep to by reading \`gh pr checks\` before every merge. Protection itself is the user's call: a paid GitHub plan, or making the repository public, after which call wire_pipeline again.`,
              ].join("\n"),
              data: { written: true, file: WORKFLOW_FILE, ref, imports, protection: { approved: false, available: false } },
            };
          }
          const command = protectionCommand(repository, systems, jobs);
          return {
            text: [
              wrote,
              "Then propose branch protection, so main takes only what CI verified. It is a repository setting: ask the user, and run this only if the user approves. Never run it yourself:",
              command,
            ].join("\n"),
            data: { written: true, file: WORKFLOW_FILE, ref, imports, protection: { approved: false, command } },
          };
        },
      );
    },
  };
}

/** What the answer says of the folders the project imports: each fetched at its commit, or named as one CI cannot fetch. */
function importsSaid(imports: readonly ImportFetch[]): string[] {
  const fetched = imports.filter((imported) => "commands" in imported);
  return [
    ...fetched.map(({ folder, repository, commit }) => `Before the tests it fetches ${folder}, which this project imports, from ${repository} at ${commit.slice(0, 7)}, beside the checkout where the folder sits, and installs its dependencies.`),
    ...(fetched.length === 0
      ? []
      : [
          "That commit stays until the user moves it: check out the commit wanted in the imported folder, call import_project on it again, then wire_pipeline again.",
          "If an imported repository is private, CI needs read access to it: propose that to the user (a deploy key or token in this repository's secrets), theirs to grant; never grant it yourself.",
        ]),
    ...imports.flatMap((imported) =>
      "unfetchable" in imported
        ? [`CI cannot fetch ${imported.folder}: ${imported.unfetchable}. Tests that stand on it will fail in CI until the user pushes it to a repository CI can read and you import it again from that checkout, then call wire_pipeline again; or the user brings that code into this project.`]
        : [],
    ),
  ];
}
