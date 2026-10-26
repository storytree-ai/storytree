/**
 * Capability 3 · The speech layer (contracts 3.1-3.4): what the owner says aloud, turned into one record or a
 * "which one?", and what the door answers, cut into short pages with no record id read aloud.
 */

/** How the speech layer sizes what it says. */
export const SPEECH = {
  pageWords: 2000,
  whichOne: 3,
  handleChars: 300,
  numberDigits: 6,
} as const;

const UNITS: Readonly<Record<string, number>> = {
  zero: 0, oh: 0, o: 0, nought: 0, nil: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Readonly<Record<string, number>> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Readonly<Record<string, number>> = { hundred: 100, thousand: 1000 };
const ORDINALS: Readonly<Record<string, number>> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, last: -1,
};

const RECORD_ID = /\b[a-z]+_[0-9a-f]{12}\b/g;

/** Lower case, "#" and hyphens as spaces, other punctuation dropped: the words a handle was said in. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[#\-–—/]/g, " ").replace(/[^a-z0-9_.' ]/g, " ").replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .split(/\s+/).filter((word) => word !== "");
}

function value(word: string): number | undefined {
  if (/^\d+$/.test(word)) return Number(word);
  return UNITS[word] ?? TEENS[word] ?? TENS[word];
}

/**
 * A number said as words or digits, or undefined when any word is not part of one. "Eleven hundred and three" counts
 * (1103); without "hundred" or "thousand" each word or pair is a group of digits, as numbers are read out: "eleven-oh-three",
 * "seventeen twenty-three" and "one one oh three" are 1103, 1723 and 1103.
 */
export function spokenNumber(said: string): number | undefined {
  const words = wordsOf(said).filter((word) => word !== "and");
  if (words.length === 0) return undefined;
  if (words.some((word) => value(word) === undefined && SCALES[word] === undefined)) return undefined;
  if (words.some((word) => SCALES[word] !== undefined)) {
    let total = 0;
    let current = 0;
    for (const word of words) {
      if (word === "hundred") current = (current || 1) * 100;
      else if (word === "thousand") {
        total += (current || 1) * 1000;
        current = 0;
      } else current += value(word)!;
    }
    return total + current;
  }
  let digits = "";
  for (let at = 0; at < words.length; at++) {
    const here = words[at]!;
    const next = words[at + 1];
    if (TENS[here] !== undefined && next !== undefined && UNITS[next] !== undefined && UNITS[next] > 0) {
      digits += String(TENS[here] + UNITS[next]);
      at++;
    } else digits += String(value(here));
  }
  if (digits.length > SPEECH.numberDigits) return undefined;
  return Number(digits);
}

/** "the second one", "2nd", "last": a position, or undefined. "last" is -1. */
function ordinal(words: readonly string[]): number | undefined {
  const rest = words.filter((word) => word !== "the" && word !== "one");
  if (rest.length !== 1) return undefined;
  const word = rest[0]!;
  const suffixed = /^(\d+)(?:st|nd|rd|th)$/.exec(word);
  if (suffixed) return Number(suffixed[1]);
  return ORDINALS[word];
}

/** What a spoken handle names, before any record is looked up. */
export type Handle =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "decision"; readonly number: number }
  | { readonly kind: "pull request"; readonly number: number }
  | { readonly kind: "position"; readonly number: number }
  | { readonly kind: "number"; readonly number: number }
  | { readonly kind: "words"; readonly words: string[] };

/** Read a handle: a record id, "decision eleven-oh-three", "pull request 1723", "number two", a bare number, or title words. */
export function parseHandle(said: string): Handle {
  const squeezed = said.trim().toLowerCase().replace(/\s+/g, "");
  if (/^[a-z]+_[0-9a-f]{12}$/.test(squeezed) || squeezed === "project-anchor") return { kind: "id", id: squeezed };
  const words = wordsOf(said);
  const after = (count: number) => {
    const rest = words.slice(count);
    return spokenNumber((rest[0] === "number" || rest[0] === "no" ? rest.slice(1) : rest).join(" "));
  };
  const lead = words[0] ?? "";
  if (lead === "decision" || lead === "adr" || /^adr\d+$/.test(lead) || (lead === "a" && words[1] === "d" && words[2] === "r")) {
    const number = /^adr(\d+)$/.exec(lead) ? Number(lead.slice(3)) : after(lead === "a" ? 3 : 1);
    if (number !== undefined) return { kind: "decision", number };
  }
  const pr = lead === "pr" ? 1 : lead === "p" && words[1] === "r" ? 2 : lead === "pull" && words[1] === "request" ? 2 : 0;
  if (pr > 0) {
    const number = after(pr);
    if (number !== undefined) return { kind: "pull request", number };
  }
  if (lead === "number" || lead === "item" || lead === "no") {
    const number = after(1) ?? ordinal(words.slice(1));
    if (number !== undefined) return { kind: "position", number };
  }
  const position = ordinal(words);
  if (position !== undefined) return { kind: "position", number: position };
  const bare = spokenNumber(words.join(" "));
  if (bare !== undefined) return { kind: "number", number: bare };
  return { kind: "words", words };
}

const STOP = new Set([
  "a", "an", "the", "of", "on", "about", "for", "to", "in", "and", "or", "that", "this", "is", "it", "one", "my", "me",
  "tell", "read", "say", "what", "whats", "what's", "with", "by", "from",
]);
/** Words that name a kind of record rather than its title. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  question: "question", questions: "question", arc: "arc", arcs: "arc", term: "definition", definition: "definition",
  word: "definition", increment: "increment", work: "increment",
};

/** A record a title can match: its kind, its title and its id. */
export interface Named {
  readonly kind: string;
  readonly title: string;
  readonly id: string;
}

function stem(word: string): string {
  return word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function sameWord(said: string, title: string): boolean {
  const a = stem(said);
  const b = stem(title);
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  return shorter.length >= 4 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * The records whose titles best hold the handle's words: every one tied at the best score, best first in the order given.
 * A kind word ("the question about…") narrows to that kind when any record of it matches. At least two thirds of the
 * handle's other words must be in a title for it to match at all.
 */
export function titleMatches(words: readonly string[], records: readonly Named[]): Named[] {
  const kinds = new Set(words.flatMap((word) => (KIND_WORDS[word] ? [KIND_WORDS[word]] : [])));
  const wanted = words.filter((word) => !STOP.has(word));
  const content = wanted.filter((word) => KIND_WORDS[word] === undefined);
  const scored = (pool: readonly Named[], said: readonly string[]) => {
    if (said.length === 0) return [];
    const scores = pool.map((record) => {
      const title = wordsOf(record.title);
      return { record, score: said.filter((word) => title.some((other) => sameWord(word, other))).length / said.length };
    });
    const best = Math.max(0, ...scores.map((one) => one.score));
    return best < 2 / 3 ? [] : scores.filter((one) => one.score === best).map((one) => one.record);
  };
  if (kinds.size > 0) {
    const narrowed = scored(records.filter((record) => kinds.has(record.kind)), content);
    if (narrowed.length > 0) return narrowed;
  }
  return scored(records, content.length > 0 ? content : wanted);
}

/** Text with its record ids left out: what may be said aloud. */
export function unspoken(text: string): string {
  return text.split("\n").map((line) =>
    line.replace(/\s*[[(]\s*[a-z]+_[0-9a-f]{12}\s*[\])]/g, "").replace(/\s*\b[a-z]+_[0-9a-f]{12}\b/g, "")
      .replace(/\s*\((?:see|in|on|from|by)?\s*\)|\s*\[\s*\]/g, "").replace(/ +([,.;:])/g, "$1").replace(/ {2,}/g, " ").trimEnd(),
  ).join("\n");
}

/** Whether a line speaks an id anywhere but at its end, after " — ". */
export function speaksAnId(line: string): boolean {
  return line.replace(/ — [a-z]+_[0-9a-f]{12}$/, "").match(RECORD_ID) !== null;
}

/** Text cut into pages of at most `words` words, at line breaks where it can and between words where a line is longer. */
export function pages(text: string, words: number = SPEECH.pageWords): string[] {
  const out: string[] = [];
  let page: string[] = [];
  let count = 0;
  const flush = () => {
    if (page.some((line) => line.trim() !== "")) out.push(page.join("\n").trim());
    page = [];
    count = 0;
  };
  for (const line of text.split("\n")) {
    let rest = line.split(/\s+/).filter((word) => word !== "");
    if (rest.length === 0) {
      page.push("");
      continue;
    }
    while (rest.length > 0) {
      if (count + rest.length <= words) {
        page.push(rest.join(" "));
        count += rest.length;
        rest = [];
      } else if (count > 0 && rest.length <= words) flush();
      else {
        const room = words - count;
        page.push(rest.slice(0, room).join(" "));
        rest = rest.slice(room);
        flush();
      }
    }
  }
  flush();
  return out.length > 0 ? out : [""];
}

/** "which one?" for two or more matches: at most three names, each id at its line's end, and how many more there were. */
export function whichOne(said: string, matches: readonly Named[]): string {
  const shown = matches.slice(0, SPEECH.whichOne);
  const lines = [`Which one? ${matches.length} match "${unspoken(said).trim()}":`];
  shown.forEach((match, at) => lines.push(`${at + 1}. ${match.kind}: ${unspoken(match.title).trim()} — ${match.id}`));
  if (matches.length > shown.length) lines.push(`(${matches.length - shown.length} more; say more of the title)`);
  return lines.join("\n");
}
