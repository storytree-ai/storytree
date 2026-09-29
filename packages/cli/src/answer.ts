/**
 * What a command answers: a short plain sentence or listing, then what you might run next
 * (capability 1). 0.2's envelope, as behaviour: the body, a blank line, and `next:` with one
 * command per line and why you would run it. A hint opens a record the answer just named or
 * listed, never a stock step (ADR-0786 D2).
 */

/** A command you might run next, and why. */
export interface Next {
  readonly command: string;
  readonly why: string;
}

export interface Answer {
  readonly text: string;
  readonly next?: readonly Next[];
}

/**
 * The door's own "no": a command it does not know, or cannot run here. It is printed like an
 * answer, on stderr, and the command exits with `code`: 2 for a command used wrongly, 1 otherwise.
 */
export class Refusal extends Error {
  readonly next: readonly Next[];
  readonly code: number;

  constructor(message: string, options: { next?: readonly Next[]; code?: number } = {}) {
    super(message);
    this.name = "Refusal";
    this.next = options.next ?? [];
    this.code = options.code ?? 1;
  }
}

/** An answer as the terminal shows it. */
export function render(answer: Answer): string {
  const text = answer.text.replace(/\s+$/, "");
  const next = answer.next ?? [];
  if (next.length === 0) return `${text}\n`;
  const width = Math.max(...next.map((step) => step.command.length));
  const lines = next.map((step) => `  - ${step.command.padEnd(width)}   (${step.why})`);
  return `${text}\n\nnext:\n${lines.join("\n")}\n`;
}

/** A record's one-line label: its title, definition term, or the first line of its text. */
export function labelOf(fields: Readonly<Record<string, unknown>>): string {
  const title = typeof fields.title === "string" ? fields.title : typeof fields.term === "string" ? fields.term : typeof fields.text === "string" ? fields.text : "";
  const line = title.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}
