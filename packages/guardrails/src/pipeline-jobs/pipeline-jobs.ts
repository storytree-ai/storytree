/**
 * Capability 3 · The check command, as a pipeline job (ADR-1170 D2, D3): Guardrails contributes `storytree check` to a
 * user's CI through its manifest's `pipelineJobs`, and App setup's wire_pipeline writes every job the parts it is
 * given contribute, so it names no Guardrails path, and with Guardrails switched off it writes no check job and
 * proposes no check status. The job runs from storytree's public source at the host's release, with only this
 * package installed (src/check/run.ts): it fetches that one commit and stops unless the checkout is at it, so the
 * check that runs is the one the release named. The job's shape is the host's declared interface, restated rather than
 * imported (ADR-1017 D2).
 */

/** A job a part contributes to a user's pipeline: its name is the status check's, and its commands run at `workspace`. */
export interface PipelineJob {
  readonly name: string;
  /** Whether it needs the checkout's whole history, with origin/main, rather than the change alone. */
  readonly needsHistory?: boolean;
  commands(ref: string, workspace: string): readonly string[];
}

export const pipelineJobs: readonly PipelineJob[] = [
  {
    name: "storytree check",
    // The self-equal assertion check compares the change with origin/main.
    needsHistory: true,
    commands: (ref, workspace) => [
      `git init --quiet "$RUNNER_TEMP/storytree"`,
      `cd "$RUNNER_TEMP/storytree"`,
      `git fetch --quiet --depth 1 https://github.com/storytree-ai/storytree.git ${ref}`,
      "git checkout --quiet FETCH_HEAD",
      // A release names a commit; from source the ref is main, which names none to compare with.
      ...(/^[0-9a-f]{40}$/.test(ref) ? [`test "$(git rev-parse HEAD)" = "${ref}"`] : []),
      "corepack enable",
      `pnpm install --frozen-lockfile --prod --ignore-scripts --filter-prod "@storytree/guardrails..."`,
      "cd packages/guardrails",
      `node --import tsx src/check/run.ts "${workspace}"`,
    ],
  },
];
