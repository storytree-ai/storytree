/** Capability 6 · Tool server (the MCP server). How the agent tools put records into their short sentences. */

/** A title, quoted as the tools quote names. */
export function quoted(title: string): string {
  return `"${title}"`;
}
