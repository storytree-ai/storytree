/**
 * Capability 6 · Agent tools: `wire_pipeline`, over the app setup's pipeline wiring (its capability 11),
 * which the agent calls when a project is set up or adopts a pipeline (ADR-0911 D3). It writes storytree's workflow into a GitHub project, or gives the commands for
 * the pipeline the user has elsewhere, and proposes branch protection for the user to approve; it never
 * changes a repository setting itself.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { checkCommands, ghProtection, importFetches, githubRepository, protectionCommand, storytreeRef, WORKFLOW_FILE, workflowFor, type ImportFetch, type ProtectionReader, type System } from "@storytree/app-setup/pipeline";
import type { Define } from "./server.js";

export function registerPipelineTools(define: Define, readProtection: ProtectionReader = ghProtection): void {
  define(
    "wire_pipeline",
    "When this project is set up or adopts a pipeline, add its tests and storytree check to its CI: on GitHub this writes storytree's workflow, elsewhere it gives the commands to add. It proposes branch protection for the user to approve and never turns it on.",
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
      if (repository === undefined) {
        const commands = [...fetches, ...(install === undefined ? [] : [install]), test, ...checkCommands(ref, "<this checkout>")];
        return {
          text: [
            "This project is not on GitHub, so nothing was written. Add these commands to the pipeline you have, run on every change before it merges (Node 24 for storytree check, with a temporary folder in RUNNER_TEMP):",
            ...commands.map((command) => `  ${command}`),
            ...said,
            "Then propose to the user that their host merge only what this pipeline verified: it is a repository setting, theirs to approve.",
          ].join("\n"),
          data: { written: false, commands, imports, protection: { approved: false } },
        };
      }
      const file = path.join(folder, WORKFLOW_FILE);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, workflowFor({ install, test, systems, ref, fetches }));
      const wrote = [
        `Wrote storytree's workflow to ${WORKFLOW_FILE}: on every pull request and push to main it runs \`${test}\` on ${systems.join(", ")}, and storytree check from storytree's source at ${ref}. Commit it on a branch and open a pull request: its first run is the proof.`,
        ...said,
      ].join("\n");
      if ((await readProtection(folder, repository)) === "refused by plan") {
        return {
          text: [
            wrote,
            `This repository cannot have branch protection: GitHub refuses it on this repository's plan (HTTP 403, a private repository on a free account), so propose no protection command. Offer the user the honest alternative instead: merge only after both checks pass (the tests and storytree check), which you keep to by reading \`gh pr checks\` before every merge. Protection itself is the user's call: a paid GitHub plan, or making the repository public, after which call wire_pipeline again.`,
          ].join("\n"),
          data: { written: true, file: WORKFLOW_FILE, ref, imports, protection: { approved: false, available: false } },
        };
      }
      const command = protectionCommand(repository, systems);
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
