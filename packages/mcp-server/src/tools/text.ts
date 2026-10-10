/** Capability 6 · Agent tools (the MCP server). How the agent tools put records into their short sentences. */
import type { Note, SchemaRecord } from "@storytree/library";

/** What a search finds: an artifact, or a story, capability or contract of the plan, found by its own words. */
export type Findable = Note | SchemaRecord<"story" | "capability" | "contract">;

/** A title, quoted as the tools quote names. */
export function quoted(title: string): string {
  return `"${title}"`;
}

/** A record's spine: what it is called, the way a shelf or a search result shows it. */
export function spineOf(note: Findable): string {
  switch (note.type) {
    case "decision":
      return note.fields.title;
    case "definition":
      return note.fields.term;
    default:
      return note.fields.title;
  }
}

/** A record's first line, below its spine: the decision's text, the definition's meaning, or the description, begun. */
export function firstLineOf(note: Findable): string {
  switch (note.type) {
    case "decision":
      return firstLine(note.fields.text);
    case "definition":
      return firstLine(note.fields.meaning);
    default:
      return firstLine(note.fields.description ?? "");
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
