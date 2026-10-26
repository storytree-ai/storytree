// Capability 11 · Carrying the repository to a new one: the settings export and its apply, run against
// recorded gh api responses (the live repo's on 2026-10-25, trimmed, with every variable value replaced).
import assert from "node:assert/strict";
import { test } from "node:test";

import { applySettings, describe, exportSettings } from "./repo-carry.mjs";

const OLD = "storytree-ai/storytree";
const NEW = "storytree-ai/storytree-flip-rehearsal";

/** A fake gh api over recorded responses: GETs answer from `recorded` (anything else is a 404); every other call is kept. */
function recordedApi(recorded) {
  const writes = [];
  const api = (endpoint, method = "GET", body) => {
    if (method !== "GET") { writes.push({ method, endpoint, body }); return { status: 200, json: {} }; }
    return recorded[endpoint] ?? { status: 404, json: { message: "Not Found" } };
  };
  return { api, writes };
}
const ok = (json) => ({ status: 200, json });

/** `reviewed` adds a reviewer and a wait timer to own-health, which the recording lacks, to show they carry. */
function liveRepo(repo, { reviewed = false } = {}) {
  return {
    [`repos/${repo}`]: ok({
      full_name: repo, visibility: "public", default_branch: "main", description: "Storytree 0.3: a map for you and your agents", homepage: "https://storytree.dev",
      has_issues: true, has_projects: true, has_wiki: true, has_discussions: false, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true,
      allow_auto_merge: true, delete_branch_on_merge: true, allow_update_branch: false, merge_commit_title: "MERGE_MESSAGE", merge_commit_message: "PR_TITLE",
      squash_merge_commit_title: "COMMIT_OR_PR_TITLE", squash_merge_commit_message: "COMMIT_MESSAGES", web_commit_signoff_required: false, allow_forking: true, is_template: false,
      security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" }, dependabot_security_updates: { status: "disabled" }, secret_scanning_non_provider_patterns: { status: "disabled" }, secret_scanning_validity_checks: { status: "disabled" } },
    }),
    [`repos/${repo}/topics`]: ok({ names: ["ai-agents", "claude", "claude-code", "developer-tools"] }),
    [`repos/${repo}/vulnerability-alerts`]: { status: 204, json: null },
    [`repos/${repo}/private-vulnerability-reporting`]: ok({ enabled: true }),
    [`repos/${repo}/automated-security-fixes`]: ok({ enabled: false, paused: false }),
    [`repos/${repo}/labels?per_page=100`]: ok([{ name: "bug", color: "d73a4a", description: "Something isn't working" }, { name: "hold", color: "ededed", description: null }]),
    [`repos/${repo}/actions/permissions`]: ok({ enabled: true, allowed_actions: "all", sha_pinning_required: false }),
    [`repos/${repo}/actions/permissions/workflow`]: ok({ default_workflow_permissions: "read", can_approve_pull_request_reviews: false }),
    [`repos/${repo}/actions/oidc/customization/sub`]: ok({ use_default: true, use_immutable_subject: true, sub_claim_prefix: "repo:storytree-ai@306221093/storytree@1388231144" }),
    [`repos/${repo}/actions/variables?per_page=100`]: ok({ total_count: 2, variables: [{ name: "HEALTH_PG_ADDRESS", value: "recorded-1" }, { name: "TS_WIF_AUDIENCE", value: "recorded-2" }] }),
    [`repos/${repo}/actions/secrets?per_page=100`]: ok({ total_count: 2, secrets: [{ name: "CSC_KEY_PASSWORD" }, { name: "MERGE_QUEUE_TOKEN" }] }),
    [`repos/${repo}/dependabot/secrets?per_page=100`]: ok({ total_count: 0, secrets: [] }),
    [`repos/${repo}/environments?per_page=100`]: ok({ total_count: 2, environments: [
      { name: "own-health", can_admins_bypass: true, protection_rules: [{ id: 67915803, type: "branch_policy" }, ...(reviewed ? [{ type: "wait_timer", wait_timer: 5 }, { type: "required_reviewers", prevent_self_review: true, reviewers: [{ type: "User", reviewer: { id: 7 } }] }] : [])], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } },
      { name: "plan-read", can_admins_bypass: true, protection_rules: [], deployment_branch_policy: null },
    ] }),
    [`repos/${repo}/environments/own-health/deployment-branch-policies?per_page=100`]: ok({ total_count: 1, branch_policies: [{ id: 62202824, name: "main", type: "branch" }] }),
    [`repos/${repo}/environments/own-health/secrets?per_page=100`]: ok({ total_count: 1, secrets: [{ name: "HEALTH_PG_PASSWORD" }] }),
    [`repos/${repo}/environments/own-health/variables?per_page=100`]: ok({ total_count: 0, variables: [] }),
    [`repos/${repo}/environments/plan-read/secrets?per_page=100`]: ok({ total_count: 1, secrets: [{ name: "PLAN_PG_PASSWORD" }] }),
    [`repos/${repo}/environments/plan-read/variables?per_page=100`]: ok({ total_count: 1, variables: [{ name: "TS_WIF_CLIENT_ID", value: "recorded-3" }] }),
    [`repos/${repo}/rulesets?per_page=100&includes_parents=false`]: ok([{ id: 24278303, name: "main merges through the merge queue (ADR-0796)", source_type: "Repository" }]),
    [`repos/${repo}/rulesets/24278303`]: ok({
      id: 24278303, name: "main merges through the merge queue (ADR-0796)", target: "branch", source_type: "Repository", source: repo, enforcement: "active",
      conditions: { ref_name: { exclude: [], include: ["refs/heads/main"] } },
      rules: [{ type: "merge_queue", parameters: { merge_method: "MERGE", max_entries_to_build: 5, min_entries_to_merge: 1, max_entries_to_merge: 5, min_entries_to_merge_wait_minutes: 0, grouping_strategy: "HEADGREEN", check_response_timeout_minutes: 45 } }],
      bypass_actors: [], current_user_can_bypass: "never",
    }),
    [`repos/${repo}/branches/main/protection`]: ok({
      required_status_checks: { strict: false, contexts: ["verify", "capability list"], checks: [{ context: "verify", app_id: 15368 }, { context: "capability list", app_id: 15368 }] },
      required_pull_request_reviews: { dismiss_stale_reviews: false, require_code_owner_reviews: false, require_last_push_approval: false, required_approving_review_count: 0 },
      required_signatures: { enabled: false }, enforce_admins: { enabled: true }, required_linear_history: { enabled: reviewed }, allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false }, block_creations: { enabled: false }, required_conversation_resolution: { enabled: false }, lock_branch: { enabled: false }, allow_fork_syncing: { enabled: false },
    }),
    [`repos/${repo}/branches/release-channel-stable`]: ok({ name: "release-channel-stable", commit: { sha: "cda531c0bd0b0ef04bf236dedd2e991a26ca967f" } }),
  };
}

/** A repo just created and given a main branch: GitHub's defaults, nothing carried yet. */
function freshRepo(repo) {
  return {
    [`repos/${repo}`]: ok({
      full_name: repo, visibility: "public", default_branch: "main", description: null, homepage: null, has_issues: true, has_projects: true, has_wiki: true, has_discussions: false,
      allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true, allow_auto_merge: false, delete_branch_on_merge: false, allow_update_branch: false,
      merge_commit_title: "MERGE_MESSAGE", merge_commit_message: "PR_TITLE", squash_merge_commit_title: "COMMIT_OR_PR_TITLE", squash_merge_commit_message: "COMMIT_MESSAGES",
      web_commit_signoff_required: false, allow_forking: true, is_template: false,
      security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" }, dependabot_security_updates: { status: "disabled" }, secret_scanning_non_provider_patterns: { status: "disabled" }, secret_scanning_validity_checks: { status: "disabled" } },
    }),
    [`repos/${repo}/topics`]: ok({ names: [] }),
    [`repos/${repo}/private-vulnerability-reporting`]: ok({ enabled: false }),
    [`repos/${repo}/automated-security-fixes`]: ok({ enabled: false, paused: false }),
    [`repos/${repo}/labels?per_page=100`]: ok([{ name: "bug", color: "d73a4a", description: "Broken" }]),
    [`repos/${repo}/actions/permissions`]: ok({ enabled: true, allowed_actions: "all", sha_pinning_required: false }),
    [`repos/${repo}/actions/permissions/workflow`]: ok({ default_workflow_permissions: "read", can_approve_pull_request_reviews: false }),
    [`repos/${repo}/actions/oidc/customization/sub`]: ok({ use_default: true, use_immutable_subject: true }),
    [`repos/${repo}/actions/variables?per_page=100`]: ok({ total_count: 1, variables: [{ name: "TS_WIF_AUDIENCE", value: "stale" }] }),
    [`repos/${repo}/actions/secrets?per_page=100`]: ok({ total_count: 1, secrets: [{ name: "CSC_KEY_PASSWORD" }] }),
    [`repos/${repo}/rulesets?per_page=100&includes_parents=false`]: ok([]),
  };
}

test("11.1 · diffing an export against a repo lists every carried setting that differs, and the writes that would close it, without writing", () => {
  const source = recordedApi(liveRepo(OLD, { reviewed: true }));
  const exported = exportSettings(source.api, OLD, new Date("2026-10-25T00:00:00Z"));
  assert.deepEqual(source.writes, [], "the export only reads");
  assert.deepEqual(exported.secrets, ["CSC_KEY_PASSWORD", "MERGE_QUEUE_TOKEN"], "secrets are carried by name");

  const target = recordedApi(freshRepo(NEW));
  const dry = applySettings(target.api, exported, NEW);
  assert.deepEqual(target.writes, [], "a dry run writes nothing");
  const writes = dry.changes.flatMap((c) => c.writes.map((w) => `${w.method} ${w.endpoint}`));
  assert.deepEqual(writes, [
    `PATCH repos/${NEW}`,
    `PUT repos/${NEW}/topics`,
    `PUT repos/${NEW}/vulnerability-alerts`,
    `PUT repos/${NEW}/private-vulnerability-reporting`,
    `PATCH repos/${NEW}/labels/bug`,
    `POST repos/${NEW}/labels`,
    `POST repos/${NEW}/actions/variables`,
    `PATCH repos/${NEW}/actions/variables/TS_WIF_AUDIENCE`,
    `PUT repos/${NEW}/environments/own-health`,
    `POST repos/${NEW}/environments/own-health/deployment-branch-policies`,
    `PUT repos/${NEW}/environments/plan-read`,
    `POST repos/${NEW}/environments/plan-read/variables`,
    `POST repos/${NEW}/rulesets`,
    `PUT repos/${NEW}/branches/main/protection`,
  ]);
  assert.deepEqual(dry.changes[0].writes[0].body, { description: exported.repo.description, homepage: "https://storytree.dev", allow_auto_merge: true, delete_branch_on_merge: true });
  const body = (endpoint) => dry.changes.flatMap((c) => c.writes).find((w) => w.endpoint === endpoint).body;
  assert.deepEqual(body(`repos/${NEW}/labels/bug`), { color: "d73a4a", description: "Something isn't working" });
  assert.deepEqual(body(`repos/${NEW}/environments/own-health`), { can_admins_bypass: true, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }, wait_timer: 5, reviewers: [{ type: "User", id: 7 }], prevent_self_review: true });
  assert.deepEqual(body(`repos/${NEW}/environments/plan-read`), { can_admins_bypass: true, deployment_branch_policy: null }, "no empty reviewer rule a plan may refuse");
  assert.deepEqual(body(`repos/${NEW}/branches/main/protection`), {
    required_status_checks: { strict: false, checks: [{ context: "capability list", app_id: 15368 }, { context: "verify", app_id: 15368 }] }, enforce_admins: true,
    required_pull_request_reviews: { dismiss_stale_reviews: false, require_code_owner_reviews: false, require_last_push_approval: false, required_approving_review_count: 0 },
    restrictions: null, required_linear_history: true, allow_force_pushes: false, allow_deletions: false, block_creations: false, required_conversation_resolution: false, lock_branch: false, allow_fork_syncing: false,
  });
  assert.deepEqual(dry.missingSecrets, [
    { scope: "repository", name: "MERGE_QUEUE_TOKEN" },
    { scope: "environment own-health", name: "HEALTH_PG_PASSWORD" },
    { scope: "environment plan-read", name: "PLAN_PG_PASSWORD" },
  ]);
  assert.ok(dry.notes.some((n) => /release-channel-stable should be at cda531c0/.test(n)), "a missing stable branch is named");
  assert.ok(!describe(dry, NEW, false).join("\n").includes("recorded-"), "the printed plan holds no variable value");

  const deferred = applySettings(recordedApi(freshRepo(NEW)).api, exported, NEW, { deferChecks: true });
  assert.equal(deferred.changes.find((c) => c.area === "protection").writes[0].body.required_status_checks, null, "required checks wait for CI's first run");

  const applied = applySettings(target.api, exported, NEW, { apply: true });
  assert.deepEqual(target.writes.map((w) => `${w.method} ${w.endpoint}`), writes, "--apply issues exactly the listed writes");
  assert.equal(applied.written.length, writes.length);

  const gatedRepo = freshRepo(NEW);
  for (const endpoint of [`repos/${NEW}/rulesets?per_page=100&includes_parents=false`, `repos/${NEW}/branches/main/protection`, `repos/${NEW}/environments?per_page=100`]) {
    gatedRepo[endpoint] = { status: 403, json: { message: "Upgrade to GitHub Pro or make this repository public to enable this feature." } };
  }
  const gated = applySettings(recordedApi(gatedRepo).api, exported, NEW);
  assert.ok(!gated.changes.some((c) => ["rulesets", "protection", "environments"].includes(c.area)), "a private repo on GitHub Free is not written what its plan withholds");
  assert.deepEqual(gated.notes.filter((n) => /not available/.test(n)).length, 3, "and each withheld area is named");

  const matched = applySettings(recordedApi(liveRepo(NEW, { reviewed: true })).api, exported, NEW);
  assert.deepEqual([matched.changes, matched.missingSecrets], [[], []], "a repo already matching the export needs nothing");
});
