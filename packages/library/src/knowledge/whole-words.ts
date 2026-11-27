// Capability 14 · Ranked search
export function wordsIn(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function singulars(word: string): string[] {
  const forms = [word];
  if (word.endsWith("ies")) forms.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) forms.push(word.slice(0, -2));
  if (word.endsWith("s")) forms.push(word.slice(0, -1));
  return forms;
}

export function normalisedWords(text: string): string {
  return wordsIn(text).join(" ");
}

export function holdsName(text: string, name: string): boolean {
  const held = wordsIn(text).map(singulars);
  const wanted = wordsIn(name);
  return wanted.length > 0 && held.some((_, start) => wanted.every((word, offset) => held[start + offset]?.includes(word) ?? false));
}
