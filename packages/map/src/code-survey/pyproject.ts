// Capability 8 · Code survey
import { parse as parseToml } from "smol-toml";

import type { SurveyPackage } from "./language-reader.js";

export const normalisedName = (name: string): string => name.trim().toLowerCase().replace(/[-_.]+/g, "-");

const tableAt = (value: unknown, ...keys: string[]): Record<string, unknown> | undefined => {
  let at = value;
  for (const key of keys) at = typeof at === "object" && at !== null && !Array.isArray(at) ? (at as Record<string, unknown>)[key] : undefined;
  return typeof at === "object" && at !== null && !Array.isArray(at) ? at as Record<string, unknown> : undefined;
};

const requirementName = (requirement: string): string | undefined => /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/.exec(requirement)?.[1];

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
