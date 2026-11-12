/**
 * Capability 8 · Code survey: a tsconfig.json's path aliases, read alike by the drawing (8.62) and the crossing (3.9).
 * A tsconfig is JSON with comments and trailing commas; its `compilerOptions.paths` are taken from its baseUrl, else its
 * folder; `extends` is not followed. It reaches no Node module, so the survey bundles for the browser (8.56).
 */

/** A tsconfig's path aliases: each key's text before and after its `*`, and its targets as paths, `*` kept; the longest key first. */
export type PathAliases = readonly { readonly before: string; readonly after?: string; readonly targets: readonly string[] }[];

/** JSON with comments and trailing commas, as tsconfig.json is written; undefined when it cannot be read. */
export function jsonc(text: string): unknown {
  let plain = "";
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    if (char === "\"") {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = at;
      const string = end.exec(text)?.[0] ?? text.slice(at);
      plain += string;
      at += string.length - 1;
    } else if (text.startsWith("//", at)) {
      at = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at) - 1;
    } else if (text.startsWith("/*", at)) {
      at = text.indexOf("*/", at) < 0 ? text.length : text.indexOf("*/", at) + 1;
    } else plain += char;
  }
  try {
    return JSON.parse(plain.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return undefined;
  }
}

/** The path aliases of the tsconfig.json in `dir` whose text is `text`: none when it declares none or cannot be read. */
export function aliasesOf(dir: string, text: string): PathAliases {
  const options = (jsonc(text) as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | undefined)?.compilerOptions;
  const base = typeof options?.baseUrl === "string" ? joinPath(dir, options.baseUrl) : dir;
  const paths = typeof options?.paths === "object" && options.paths !== null ? Object.entries(options.paths) : [];
  return paths.map(([key, targets]) => {
    const star = key.indexOf("*");
    const listed = Array.isArray(targets) ? targets.filter((one): one is string => typeof one === "string") : [];
    return { before: star < 0 ? key : key.slice(0, star), ...(star < 0 ? {} : { after: key.slice(star + 1) }), targets: listed.map((one) => joinPath(base, one)) };
  }).sort((a, b) => b.before.length - a.before.length);
}

/** The paths `specifier` names through `aliases`, in the order they are tried (each matching alias, the longest key first); none when no alias matches it. */
export function aliasTargets(specifier: string, aliases: PathAliases): string[] {
  return aliases.flatMap((alias) => {
    const star = alias.after === undefined ? undefined : specifier.startsWith(alias.before) && specifier.endsWith(alias.after) && specifier.length >= alias.before.length + alias.after.length
      ? specifier.slice(alias.before.length, specifier.length - alias.after.length) : undefined;
    if (alias.after === undefined ? specifier !== alias.before : star === undefined) return [];
    return alias.targets.map((target) => {
      const at = target.indexOf("*");
      return star === undefined || at < 0 ? target : `${target.slice(0, at)}${star}${target.slice(at + 1)}`;
    });
  });
}

/** `relative` from the folder `dir`, with `.` and `..` worked out, as POSIX paths join; "." for the folder itself. */
export function joinPath(dir: string, relative: string): string {
  const parts: string[] = [];
  for (const part of `${dir}/${relative}`.split("/")) {
    if (part === ".." && parts.length > 0 && parts.at(-1) !== ".." && parts.at(-1) !== "") parts.pop();
    else if (part !== "." && (part !== "" || parts.length === 0)) parts.push(part);
  }
  return parts.join("/") || ".";
}
