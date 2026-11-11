/**
 * Capability 3 · Arc surface. An arc grown past its size tripwire (ADR-1321 D3, contract 3.40): one holding more than 20
 * increments, open and closed together, is due for decomposition. It is a flag, never a refusal: `arc show`, `arc status`
 * and the MCP server's show_plan say it, and parking, moving and closing work on the arc behave as before.
 */

/** The most increments, open and closed together, an arc holds before it is flagged (ADR-1321 D3). */
export const ARC_SIZE_LIMIT = 20;

/** What an arc holding `count` increments says about its size: the flag past the limit, nothing at or under it. */
export function oversizedSaid(count: number): string | undefined {
  if (count <= ARC_SIZE_LIMIT) return undefined;
  return `Due for decomposition: it holds ${count} increments, open and closed, more than ${ARC_SIZE_LIMIT}; ADR-1321 asks for a split into goal-scoped arcs, moving closed history with \`arc increment move\`.`;
}
