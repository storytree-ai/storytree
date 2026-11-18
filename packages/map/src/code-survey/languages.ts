// Capability 8 · Code survey

type Language = { readonly name: string; readonly files: RegExp; readonly read?: true };

const LANGUAGES: readonly Language[] = [
  { name: "JavaScript", files: /\.[cm]?jsx?$/, read: true },
  { name: "TypeScript", files: /\.[cm]?tsx?$/, read: true },
  { name: "Python", files: /\.py$/, read: true },
  { name: "Go", files: /\.go$/ },
  { name: "Rust", files: /\.rs$/ },
  { name: "Java", files: /\.java$/ },
  { name: "Kotlin", files: /\.kts?$/ },
  { name: "Scala", files: /\.scala$/ },
  { name: "C#", files: /\.cs$/ },
  { name: "F#", files: /\.fsx?$/ },
  { name: "C", files: /\.[ch]$/ },
  { name: "C++", files: /\.(?:cc|cpp|cxx|hh|hpp|hxx)$/ },
  { name: "Swift", files: /\.swift$/ },
  { name: "Objective-C", files: /\.mm?$/ },
  { name: "Ruby", files: /\.rb$/ },
  { name: "PHP", files: /\.php$/ },
  { name: "Elixir", files: /\.exs?$/ },
  { name: "Erlang", files: /\.erl$/ },
  { name: "Haskell", files: /\.hs$/ },
  { name: "Dart", files: /\.dart$/ },
  { name: "Lua", files: /\.lua$/ },
  { name: "Zig", files: /\.zig$/ },
  { name: "SQL", files: /\.sql$/ },
];

export const SURVEYED_LANGUAGES: readonly string[] = LANGUAGES.filter((language) => language.read).map((language) => language.name);

export const UNREAD_LANGUAGES: readonly string[] = LANGUAGES.filter((language) => !language.read).map((language) => language.name);

export function languageList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function unreadableOf(languages: { readonly read: readonly string[]; readonly unread: readonly string[] } | undefined): string[] | undefined {
  return languages !== undefined && languages.read.length === 0 && languages.unread.length > 0 ? [...languages.unread] : undefined;
}

export function unreadableSentence(unreadable: readonly string[]): string {
  return `storytree's map reads ${languageList(SURVEYED_LANGUAGES)}, and this folder's code is in ${languageList(unreadable)}, so the map will not draw that code: planning by hand still works, and so does health from what the agent reports.`;
}

export function languagesOf(paths: Iterable<string>): { readonly read: string[]; readonly unread: string[] } {
  const found = new Set<Language>();
  for (const path of paths) {
    const language = LANGUAGES.find((one) => one.files.test(path));
    if (language !== undefined) found.add(language);
  }
  const named = LANGUAGES.filter((language) => found.has(language));
  return { read: named.filter((language) => language.read).map((language) => language.name), unread: named.filter((language) => !language.read).map((language) => language.name) };
}
