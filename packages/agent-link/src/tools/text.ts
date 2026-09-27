/** How the agent tools put records into their short sentences. */
import type { Note } from "@storytree/library";

/** A title, quoted as the tools quote names. */
export function quoted(title: string): string {
  return `"${title}"`;
}

/** An artifact's spine: what it is called, the way a shelf or a search result shows it. */
export function spineOf(note: Note): string {
  switch (note.type) {
    case "decision":
      return note.fields.title;
    case "definition":
      return note.fields.term;
    default:
      return note.fields.title;
  }
}

/** An artifact's first line, below its spine: the decision's text or the definition's meaning, begun. */
export function firstLineOf(note: Note): string {
  switch (note.type) {
    case "decision":
      return firstLine(note.fields.text);
    case "definition":
      return firstLine(note.fields.meaning);
    default:
      return firstLine(note.fields.description);
  }
}

/** An artifact in full, as opening it shows it. */
export function wholeOf(note: Note): string {
  switch (note.type) {
    case "decision":
      return `Decision ${quoted(note.fields.title)} (${note.id}):\n${note.fields.text}`;
    case "definition":
      return `Definition of ${quoted(note.fields.term)} (${note.id}):\n${note.fields.meaning}`;
    default: {
      // One of the library's eight further kinds (ADR-0640): its title, its one-line description,
      // and each other field that holds words, by name.
      const { title, description, ...rest } = note.fields as Record<string, unknown>;
      const fields = Object.entries(rest).flatMap(([name, value]) => (typeof value === "string" ? [`${name}: ${value}`] : []));
      return [`${KIND_NAMES[note.type] ?? note.type} ${quoted(String(title))} (${note.id}):`, String(description), ...fields].join("\n");
    }
  }
}

/** What the eight further kinds are called in a sentence. */
const KIND_NAMES: Readonly<Record<string, string>> = {
  principle: "Principle",
  guardrail: "Guardrail",
  pattern: "Pattern",
  process: "Process",
  agent: "Agent role",
  friction: "Friction",
  resteer: "Re-steer",
  techstack: "Tech stack",
};

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}
