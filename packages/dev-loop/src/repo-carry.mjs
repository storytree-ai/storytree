// Capability 11 · Carrying the repository to a new one (decision_57ef52a34c8e). The flip to a fresh
// storytree repo (arc_824a506f2125, runbook process_761459dc626c) carries the live repo's settings by
// script: `export` reads everything the inventory (research_4b3100894f88) marks SCRIPT into a JSON file
// outside the checkout (variable values are readable, so the file is never committed); `apply` reads a
// target repo's live state, diffs the export against it, prints each setting that differs with the gh api
// write that would close it, and names the secrets the target lacks. Nothing is written unless --apply is
// given. Secret values are never read or written: the owner pastes them.
//
//   node packages/dev-loop/src/repo-carry.mjs export --repo storytree-ai/storytree --out <file>
//   node packages/dev-loop/src/repo-carry.mjs apply --repo <target> --from <file> [--defer-checks] [--apply]
//   node packages/dev-loop/src/repo-carry.mjs create --repo <owner/name>  [--apply]   (a private, empty rehearsal repo)

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository fields a PATCH on the repo sets, as GET reads them. */
const REPO_FIELDS = [
  "description", "homepage", "visibility", "has_issues", "has_projects", "has_wiki", "has_discussions",
  "allow_merge_commit", "allow_squash_merge", "allow_rebase_merge", "allow_auto_merge", "delete_branch_on_merge",
  "allow_update_branch", "merge_commit_title", "merge_commit_message", "squash_merge_commit_title",
  "squash_merge_commit_message", "web_commit_signoff_required", "allow_forking", "is_template", "default_branch",
];
const SECURITY = [
  "secret_scanning", "secret_scanning_push_protection", "dependabot_security_updates",
  "secret_scanning_non_provider_patterns", "secret_scanning_validity_checks",
];
/** Switches GitHub answers with an endpoint of their own: on is 204 (or enabled: true), off is 404. */
const SWITCHES = { vulnerability_alerts: "vulnerability-alerts", private_vulnerability_reporting: "private-vulnerability-reporting", automated_security_fixes: "automated-security-fixes" };

/**
 * gh api as a function: `api(endpoint, method, body)` answers { status, json }. A failed call's status is
 * the HTTP code gh reports; anything but a 404 on a read throws in the readers below.
 */
export function ghApi(endpoint, method = "GET", body) {
  const args = ["api", endpoint, "--method", method, "-H", "Accept: application/vnd.github+json"];
  if (body !== undefined) args.push("--input", "-");
  const result = spawnSync("gh", args, { encoding: "utf8", input: body === undefined ? undefined : JSON.stringify(body), maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status === 0) return { status: result.stdout.trim() === "" ? 204 : 200, json: result.stdout.trim() === "" ? null : JSON.parse(result.stdout) };
  const code = /\(HTTP (\d{3})\)/.exec(result.stderr)?.[1];
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* gh printed no body */ }
  return { status: code ? Number(code) : 0, json, error: result.stderr.trim() };
}

/** What a repo answers for a feature its plan withholds (a private repo on GitHub Free): read as unavailable, not as a failure. */
const GATED = /Upgrade to GitHub Pro|make this repository public/;
const unavailable = (answer) => answer.status === 403 && GATED.test(`${answer.error ?? ""} ${answer.json?.message ?? ""}`);

function read(api, endpoint, { missing, gated = false } = {}) {
  const answer = api(endpoint, "GET");
  if (answer.status === 404 && missing !== undefined) return missing;
  if (gated && unavailable(answer)) return { unavailable: true };
  if (answer.status >= 300 || answer.status === 0) throw new Error(`GET ${endpoint} failed (${answer.status}): ${answer.error ?? JSON.stringify(answer.json)}`);
  return answer.json;
}

const pick = (object, keys) => Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]));
const byName = (list) => [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/** Classic protection as the PUT body that sets it, from the GET's shape (null when the branch has none). */
function protectionBody(live) {
  if (live === null) return null;
  const checks = live.required_status_checks;
  const reviews = live.required_pull_request_reviews;
  const restrictions = live.restrictions;
  return {
    required_status_checks: checks ? { strict: checks.strict, checks: byContext(checks.checks ?? checks.contexts.map((context) => ({ context }))) } : null,
    enforce_admins: live.enforce_admins?.enabled ?? false,
    required_pull_request_reviews: reviews ? pick(reviews, ["dismiss_stale_reviews", "require_code_owner_reviews", "require_last_push_approval", "required_approving_review_count"]) : null,
    restrictions: restrictions ? { users: restrictions.users.map((u) => u.login), teams: restrictions.teams.map((t) => t.slug), apps: restrictions.apps.map((a) => a.slug) } : null,
    required_linear_history: live.required_linear_history?.enabled ?? false,
    allow_force_pushes: live.allow_force_pushes?.enabled ?? false,
    allow_deletions: live.allow_deletions?.enabled ?? false,
    block_creations: live.block_creations?.enabled ?? false,
    required_conversation_resolution: live.required_conversation_resolution?.enabled ?? false,
    lock_branch: live.lock_branch?.enabled ?? false,
    allow_fork_syncing: live.allow_fork_syncing?.enabled ?? false,
  };
}
const byContext = (checks) => checks.map((c) => ({ context: c.context, ...(c.app_id ? { app_id: c.app_id } : {}) })).sort((a, b) => (a.context < b.context ? -1 : 1));

function readEnvironment(api, repo, environment) {
  const name = environment.name;
  const base = `repos/${repo}/environments/${encodeURIComponent(name)}`;
  const reviewers = (environment.protection_rules ?? []).filter((rule) => rule.type === "required_reviewers");
  const timer = (environment.protection_rules ?? []).find((rule) => rule.type === "wait_timer");
  const policy = environment.deployment_branch_policy ?? null;
  const branchPolicies = policy?.custom_branch_policies
    ? byName(read(api, `${base}/deployment-branch-policies?per_page=100`).branch_policies.map((p) => ({ name: p.name, type: p.type ?? "branch" })))
    : [];
  return {
    name,
    can_admins_bypass: environment.can_admins_bypass ?? true,
    wait_timer: timer?.wait_timer ?? 0,
    prevent_self_review: reviewers[0]?.prevent_self_review ?? false,
    reviewers: reviewers.flatMap((rule) => rule.reviewers.map((r) => ({ type: r.type, id: r.reviewer.id }))),
    deployment_branch_policy: policy && { protected_branches: policy.protected_branches, custom_branch_policies: policy.custom_branch_policies },
    branch_policies: branchPolicies,
    secrets: read(api, `${base}/secrets?per_page=100`, { missing: { secrets: [] } }).secrets.map((s) => s.name).sort(),
    variables: byName(read(api, `${base}/variables?per_page=100`, { missing: { variables: [] } }).variables.map((v) => ({ name: v.name, value: v.value }))),
  };
}

/** The repo's carried settings, as the export holds them and as a target's live state is compared. */
export function readSettings(api, repo) {
  const meta = read(api, `repos/${repo}`);
  const actions = read(api, `repos/${repo}/actions/permissions`);
  const rulesets = read(api, `repos/${repo}/rulesets?per_page=100&includes_parents=false`, { missing: [], gated: true });
  const environments = read(api, `repos/${repo}/environments?per_page=100`, { missing: { environments: [] }, gated: true });
  const protection = read(api, `repos/${repo}/branches/${meta.default_branch}/protection`, { missing: null, gated: true });
  const switches = {};
  for (const [key, endpoint] of Object.entries(SWITCHES)) {
    const answer = read(api, `repos/${repo}/${endpoint}`, { missing: { enabled: false }, gated: true });
    switches[key] = answer === null ? true : answer.unavailable ? answer : answer.enabled === true;
  }
  const oidc = read(api, `repos/${repo}/actions/oidc/customization/sub`, { missing: { use_default: true } });
  return {
    repo: pick(meta, REPO_FIELDS),
    topics: [...read(api, `repos/${repo}/topics`).names].sort(),
    security: Object.fromEntries(SECURITY.map((key) => [key, meta.security_and_analysis?.[key]?.status ?? "disabled"])),
    switches,
    labels: byName(read(api, `repos/${repo}/labels?per_page=100`).map((l) => ({ name: l.name, color: l.color, description: l.description ?? "" }))),
    actions: {
      permissions: pick(actions, ["enabled", "allowed_actions", "sha_pinning_required"]),
      selected: actions.allowed_actions === "selected" ? read(api, `repos/${repo}/actions/permissions/selected-actions`) : null,
      workflow: read(api, `repos/${repo}/actions/permissions/workflow`),
      oidc: pick(oidc, ["use_default", "include_claim_keys"]),
    },
    variables: byName(read(api, `repos/${repo}/actions/variables?per_page=100`).variables.map((v) => ({ name: v.name, value: v.value }))),
    secrets: read(api, `repos/${repo}/actions/secrets?per_page=100`).secrets.map((s) => s.name).sort(),
    dependabot_secrets: read(api, `repos/${repo}/dependabot/secrets?per_page=100`, { missing: { secrets: [] } }).secrets.map((s) => s.name).sort(),
    environments: environments.unavailable ? environments : byName(environments.environments.map((environment) => readEnvironment(api, repo, environment))),
    rulesets: rulesets.unavailable ? rulesets : byName(rulesets.filter((r) => r.source_type === "Repository").map((summary) => {
      const r = read(api, `repos/${repo}/rulesets/${summary.id}`);
      return { id: r.id, name: r.name, target: r.target, enforcement: r.enforcement, conditions: r.conditions, rules: r.rules, bypass_actors: r.bypass_actors ?? [] };
    })),
    protection: { [meta.default_branch]: protection?.unavailable ? protection : protectionBody(protection) },
    branches: Object.fromEntries(["release-channel-stable"].map((branch) => [branch, read(api, `repos/${repo}/branches/${branch}`, { missing: null })?.commit.sha ?? null])),
  };
}

export function exportSettings(api, repo, now = new Date()) {
  return { schema: 1, source: repo, exported_at: now.toISOString(), ...readSettings(api, repo) };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rulesetBody = (r) => ({ name: r.name, target: r.target, enforcement: r.enforcement, conditions: r.conditions, rules: r.rules, bypass_actors: r.bypass_actors });

/**
 * What applying `wanted` (an export) to `repo` would change, given its live state `have`: one entry per
 * differing setting, each with the writes that close it, in the order they must run; and the secret names
 * the target lacks, which only the owner can paste. `deferChecks` leaves the default branch's required
 * status checks off, since they resolve only after CI has run once on the new repo.
 */
export function diffSettings(wanted, have, repo, { deferChecks = false } = {}) {
  const changes = [];
  const missingSecrets = [];
  const notes = [];
  const add = (area, name, want, live, writes) => changes.push({ area, name, want, have: live, writes });
  const withheld = (area) => notes.push(`${area}: not available on ${repo} (a private repo on GitHub Free); not checked or written`);

  const repoFields = Object.fromEntries(REPO_FIELDS.filter((key) => key in wanted.repo && !same(wanted.repo[key], have.repo[key])).map((key) => [key, wanted.repo[key]]));
  const branchMissing = repoFields.default_branch !== undefined;
  delete repoFields.default_branch;
  // Visibility is the owner's to set when he creates the repo (process_761459dc626c step 4): named, never written.
  if (repoFields.visibility !== undefined) notes.push(`${repo} is ${have.repo.visibility}, the export's repo was ${repoFields.visibility}; visibility is set by hand, not by this script`);
  delete repoFields.visibility;
  if (Object.keys(repoFields).length) {
    add("repo", Object.keys(repoFields).join(", "), repoFields, pick(have.repo, Object.keys(repoFields)), [{ method: "PATCH", endpoint: `repos/${repo}`, body: repoFields }]);
  }
  if (branchMissing) add("repo", "default_branch", wanted.repo.default_branch, have.repo.default_branch, [{ method: "PATCH", endpoint: `repos/${repo}`, body: { default_branch: wanted.repo.default_branch } }]);

  if (!same(wanted.topics, have.topics)) add("topics", "topics", wanted.topics, have.topics, [{ method: "PUT", endpoint: `repos/${repo}/topics`, body: { names: wanted.topics } }]);

  for (const key of SECURITY) {
    if (wanted.security[key] !== have.security[key]) {
      add("security", key, wanted.security[key], have.security[key], [{ method: "PATCH", endpoint: `repos/${repo}`, body: { security_and_analysis: { [key]: { status: wanted.security[key] } } } }]);
    }
  }
  for (const [key, endpoint] of Object.entries(SWITCHES)) {
    if (have.switches[key]?.unavailable) withheld(key);
    else if (wanted.switches[key] !== have.switches[key]) add("security", key, wanted.switches[key], have.switches[key], [{ method: wanted.switches[key] ? "PUT" : "DELETE", endpoint: `repos/${repo}/${endpoint}` }]);
  }

  const liveLabels = new Map(have.labels.map((l) => [l.name, l]));
  for (const label of wanted.labels) {
    const live = liveLabels.get(label.name);
    if (!live) add("labels", label.name, label, null, [{ method: "POST", endpoint: `repos/${repo}/labels`, body: label }]);
    else if (!same(label, live)) add("labels", label.name, label, live, [{ method: "PATCH", endpoint: `repos/${repo}/labels/${encodeURIComponent(label.name)}`, body: { color: label.color, description: label.description } }]);
  }
  const extraLabels = have.labels.filter((l) => !wanted.labels.some((w) => w.name === l.name)).map((l) => l.name);
  if (extraLabels.length) notes.push(`labels on ${repo} the export does not hold (left as they are): ${extraLabels.join(", ")}`);

  if (!same(wanted.actions.permissions, have.actions.permissions)) add("actions", "permissions", wanted.actions.permissions, have.actions.permissions, [{ method: "PUT", endpoint: `repos/${repo}/actions/permissions`, body: wanted.actions.permissions }]);
  if (wanted.actions.selected && !same(wanted.actions.selected, have.actions.selected)) add("actions", "selected actions", wanted.actions.selected, have.actions.selected, [{ method: "PUT", endpoint: `repos/${repo}/actions/permissions/selected-actions`, body: wanted.actions.selected }]);
  if (!same(wanted.actions.workflow, have.actions.workflow)) add("actions", "workflow token", wanted.actions.workflow, have.actions.workflow, [{ method: "PUT", endpoint: `repos/${repo}/actions/permissions/workflow`, body: wanted.actions.workflow }]);
  if (!same(wanted.actions.oidc, have.actions.oidc)) add("actions", "oidc subject", wanted.actions.oidc, have.actions.oidc, [{ method: "PUT", endpoint: `repos/${repo}/actions/oidc/customization/sub`, body: wanted.actions.oidc }]);

  const variables = (base, want, live, area) => {
    const liveByName = new Map(live.map((v) => [v.name, v]));
    for (const variable of want) {
      const current = liveByName.get(variable.name);
      // A variable's value is shown only by name in the printed plan, never its value.
      if (!current) add(area, variable.name, "(set)", null, [{ method: "POST", endpoint: `${base}/variables`, body: variable }]);
      else if (current.value !== variable.value) add(area, variable.name, "(changed)", "(differs)", [{ method: "PATCH", endpoint: `${base}/variables/${variable.name}`, body: variable }]);
    }
  };
  variables(`repos/${repo}/actions`, wanted.variables, have.variables, "variables");
  for (const name of wanted.secrets) if (!have.secrets.includes(name)) missingSecrets.push({ scope: "repository", name });
  for (const name of wanted.dependabot_secrets ?? []) if (!(have.dependabot_secrets ?? []).includes(name)) missingSecrets.push({ scope: "dependabot", name });

  const liveEnvironments = new Map(have.environments.unavailable ? [] : have.environments.map((e) => [e.name, e]));
  if (have.environments.unavailable) withheld("environments");
  for (const environment of have.environments.unavailable ? [] : wanted.environments) {
    const live = liveEnvironments.get(environment.name);
    const base = `repos/${repo}/environments/${encodeURIComponent(environment.name)}`;
    const shape = (e) => e && pick(e, ["can_admins_bypass", "wait_timer", "prevent_self_review", "reviewers", "deployment_branch_policy"]);
    if (!live || !same(shape(environment), shape(live))) {
      // Only the rules it holds: an empty reviewers list or a zero timer is still a rule a plan may refuse.
      const body = { can_admins_bypass: environment.can_admins_bypass, deployment_branch_policy: environment.deployment_branch_policy };
      if (environment.wait_timer) body.wait_timer = environment.wait_timer;
      if (environment.reviewers.length) Object.assign(body, { reviewers: environment.reviewers, prevent_self_review: environment.prevent_self_review });
      add("environments", environment.name, shape(environment), shape(live) ?? null, [{ method: "PUT", endpoint: base, body }]);
    }
    const livePolicies = live?.branch_policies ?? [];
    for (const policy of environment.branch_policies) {
      if (!livePolicies.some((p) => p.name === policy.name && p.type === policy.type)) add("environments", `${environment.name} deploys from ${policy.name}`, policy, null, [{ method: "POST", endpoint: `${base}/deployment-branch-policies`, body: policy }]);
    }
    variables(base, environment.variables, live?.variables ?? [], `environment ${environment.name} variables`);
    for (const name of environment.secrets) if (!(live?.secrets ?? []).includes(name)) missingSecrets.push({ scope: `environment ${environment.name}`, name });
  }

  const liveRulesets = new Map(have.rulesets.unavailable ? [] : have.rulesets.map((r) => [r.name, r]));
  if (have.rulesets.unavailable) withheld("rulesets");
  for (const ruleset of have.rulesets.unavailable ? [] : wanted.rulesets) {
    const live = liveRulesets.get(ruleset.name);
    if (!live) add("rulesets", ruleset.name, rulesetBody(ruleset), null, [{ method: "POST", endpoint: `repos/${repo}/rulesets`, body: rulesetBody(ruleset) }]);
    else if (!same(rulesetBody(ruleset), rulesetBody(live))) add("rulesets", ruleset.name, rulesetBody(ruleset), rulesetBody(live), [{ method: "PUT", endpoint: `repos/${repo}/rulesets/${live.id}`, body: rulesetBody(ruleset) }]);
  }

  for (const [branch, body] of Object.entries(wanted.protection)) {
    const want = body && deferChecks ? { ...body, required_status_checks: null } : body;
    if (body && deferChecks && body.required_status_checks) notes.push(`required checks on ${branch} deferred until CI has run once: ${body.required_status_checks.checks.map((c) => c.context).join(", ")}`);
    const live = have.protection[branch] ?? null;
    if (live?.unavailable) { withheld(`branch protection on ${branch}`); continue; }
    if (same(want, live)) continue;
    add("protection", branch, want, live, [want === null
      ? { method: "DELETE", endpoint: `repos/${repo}/branches/${branch}/protection` }
      : { method: "PUT", endpoint: `repos/${repo}/branches/${branch}/protection`, body: want }]);
  }

  for (const [branch, sha] of Object.entries(wanted.branches)) {
    if (sha !== null && have.branches[branch] !== sha) notes.push(`branch ${branch} should be at ${sha.slice(0, 8)} (push it with its history; it is ${have.branches[branch]?.slice(0, 8) ?? "missing"})`);
  }
  return { changes, missingSecrets, notes };
}

/**
 * Diffs the export against `repo`'s live state and, with `apply`, issues every write in order. Answers the
 * diff and the writes it made; without `apply` it makes none.
 */
export function applySettings(api, wanted, repo, { apply = false, deferChecks = false } = {}) {
  const diff = diffSettings(wanted, readSettings(api, repo), repo, { deferChecks });
  const written = [];
  const failed = [];
  if (apply) {
    // A refused write is listed and the rest still run, so one pass names everything still to fix.
    for (const change of diff.changes) {
      for (const write of change.writes) {
        const answer = api(write.endpoint, write.method, write.body);
        if (answer.status >= 300 || answer.status === 0) failed.push({ ...write, status: answer.status, error: answer.error ?? JSON.stringify(answer.json) });
        else written.push(write);
      }
    }
  }
  return { ...diff, written, failed };
}

/** The diff as lines to print: values of variables never appear. */
export function describe(result, repo, apply) {
  const lines = [];
  lines.push(result.changes.length === 0 ? `${repo}: every carried setting matches the export.` : `${repo}: ${result.changes.length} setting(s) differ from the export${apply ? "; written:" : " (dry run, nothing written; --apply writes them):"}`);
  for (const change of result.changes) {
    const shown = (value) => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
    lines.push(`  ${change.area} · ${change.name}: ${shown(change.have)} -> ${shown(change.want)}`);
    for (const write of change.writes) lines.push(`      ${write.method} ${write.endpoint}`);
  }
  if (result.missingSecrets.length) {
    lines.push(`Secrets the owner must paste on ${repo} (names only):`);
    for (const secret of result.missingSecrets) lines.push(`  ${secret.scope}: ${secret.name}`);
  } else lines.push("Every expected secret name exists.");
  for (const note of result.notes) lines.push(`Note: ${note}`);
  return lines;
}

function insideCheckout(file) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: path.dirname(path.resolve(file)), encoding: "utf8" });
  return result.status === 0;
}

function main(argv) {
  const [command, ...rest] = argv;
  const flag = (name) => { const i = rest.indexOf(`--${name}`); return i === -1 ? undefined : rest[i + 1]; };
  const has = (name) => rest.includes(`--${name}`);
  const repo = flag("repo");
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Give --repo <owner/name>");
  if (command === "export") {
    const out = flag("out");
    if (!out) throw new Error("Give --out <file> outside the checkout: the export holds variable values and is never committed");
    if (insideCheckout(out)) throw new Error(`Refusing to write the export inside a git checkout (${out}): it holds variable values`);
    const settings = exportSettings(ghApi, repo);
    writeFileSync(out, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
    console.log(`Exported ${repo}'s settings to ${out}: ${settings.labels.length} labels, ${settings.variables.length} variables, ${settings.secrets.length} secret names, ${settings.environments.length} environments, ${settings.rulesets.length} rulesets.`);
  } else if (command === "apply") {
    const from = flag("from");
    if (!from) throw new Error("Give --from <export file>");
    const wanted = JSON.parse(readFileSync(from, "utf8"));
    if (wanted.schema !== 1) throw new Error(`${from} is not a settings export (schema 1)`);
    const result = applySettings(ghApi, wanted, repo, { apply: has("apply"), deferChecks: has("defer-checks") });
    for (const line of describe(result, repo, has("apply"))) console.log(line);
    if (has("apply")) console.log(`Wrote ${result.written.length} change(s). Run again without --apply to see what still differs.`);
    for (const failure of result.failed) console.error(`Refused: ${failure.method} ${failure.endpoint} (${failure.status}): ${failure.error}`);
    if (result.failed.length) process.exitCode = 1;
  } else if (command === "create") {
    const [owner, name] = repo.split("/");
    if (!has("apply")) { console.log(`Would create ${repo}: private, empty (dry run; --apply creates it).`); return; }
    const answer = ghApi(`orgs/${owner}/repos`, "POST", { name, private: true, auto_init: false, description: "Rehearsal of the storytree repo flip; delete when done." });
    if (answer.status >= 300) throw new Error(`Could not create ${repo} (${answer.status}): ${answer.error}`);
    console.log(`Created ${answer.json.full_name} (id ${answer.json.id}), private.`);
  } else throw new Error("Commands: export, apply, create");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
