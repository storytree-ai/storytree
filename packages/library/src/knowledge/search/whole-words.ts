// Capability 14 · Search

export function normalisedWords(text: string): string {
  return text.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

const WORD_BEFORE = /[\p{L}\p{N}]$/u;
const WORD_AFTER = /^[\p{L}\p{N}]/u;

export function holdsName(text: string, name: string): boolean {
  const haystack = normalisedWords(text);
  const words = normalisedWords(name);
  const forms = words.endsWith("y") ? [words, `${words.slice(0, -1)}ies`] : [words, `${words}s`, `${words}es`];
  return forms.some((form) => {
    for (let at = haystack.indexOf(form); at !== -1; at = at === haystack.length ? -1 : haystack.indexOf(form, at + 1)) {
      const end = at + form.length;
      if (!WORD_BEFORE.test(haystack.slice(Math.max(0, at - 2), at)) && !WORD_AFTER.test(haystack.slice(end, end + 2))) return true;
    }
    return false;
  });
}
