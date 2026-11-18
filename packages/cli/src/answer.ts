// Capability 1 · Front door

export interface Next {
  readonly command: string;
  readonly why: string;
}

export interface Answer {
  readonly text: string;
  readonly next?: readonly Next[];
  readonly raw?: boolean;
}

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

export class UnknownCommand extends Refusal {
  readonly word: string;
  readonly named: string | undefined;

  constructor(message: string, word: string, named: string | undefined, options: { next?: readonly Next[]; code?: number } = {}) {
    super(message, options);
    this.word = word;
    this.named = named;
  }
}

export function render(answer: Answer): string {
  if (answer.raw === true) return answer.text;
  const text = answer.text.trimEnd();
  const next = answer.next ?? [];
  if (next.length === 0) return `${text}\n`;
  const width = Math.max(...next.map((step) => step.command.length));
  const lines = next.map((step) => `  - ${step.command.padEnd(width)}   (${step.why})`);
  return `${text}\n\nnext:\n${lines.join("\n")}\n`;
}

export function labelOf(fields: Readonly<Record<string, unknown>>): string {
  const title = typeof fields.title === "string" ? fields.title : typeof fields.term === "string" ? fields.term : typeof fields.text === "string" ? fields.text : "";
  const line = title.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}
