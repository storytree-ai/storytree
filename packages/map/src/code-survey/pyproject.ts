/**
 * Capability 8 · Code survey: a Python package's pyproject.toml, read as the disk survey reads a package (8.52): its
 * project's name and the projects it depends on, by [project].dependencies and by the workspace sources of
 * [tool.uv.sources], each name normalised as PEP 503 does. Node only, beside read-survey.ts.
 */
import { parse as parseToml } from "smol-toml";

import type { SurveyPackage } from "./language-reader.js";

/** A project's name as PEP 503 compares it: lower case, with runs of - _ . alike. */
export const normalisedName = (name: string): string => name.trim().toLowerCase().replace(/[-_.]+/g, "-");

/** The table at `keys` inside a TOML value, or nothing. */
const tableAt = (value: unknown, ...keys: string[]): Record<string, unknown> | undefined => {
  let at = value;
  for (const key of keys) at = typeof at === "object" && at !== null && !Array.isArray(at) ? (at as Record<string, unknown>)[key] : undefined;
  return typeof at === "object" && at !== null && !Array.isArray(at) ? at as Record<string, unknown> : undefined;
};

/** A PEP 508 requirement's project name: its leading name, before any extras, version or marker. */
const requirementName = (requirement: string): string | undefined => /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/.exec(requirement)?.[1];

/**
 * A pyproject.toml's project, as the survey reads a package: its name and the projects it depends on, both
 * normalised; nothing when it is no TOML or names no project. Its exports and imports are none.
 */
export function pyprojectFrom(text: string): Omit<SurveyPackage, "root"> & { deps: string[] } | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const project = tableAt(parsed, "project");
  if (typeof project?.name !== "string") return undefined;
  const requirements = Array.isArray(project.dependencies) ? project.dependencies.filter((one): one is string => typeof one === "string") : [];
  const sources = Object.entries(tableAt(parsed, "tool", "uv", "sources") ?? {}).filter(([, source]) => tableAt(source)?.workspace === true).map(([name]) => name);
  const deps = [...requirements.flatMap((one) => requirementName(one) ?? []), ...sources].map(normalisedName);
  return { name: normalisedName(project.name), deps: [...new Set(deps)], exports: {} };
}
