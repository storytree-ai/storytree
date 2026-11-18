// Capability 3 · Arc surface.

export const ARC_SIZE_LIMIT = 20;

export function oversizedSaid(count: number): string | undefined {
  if (count <= ARC_SIZE_LIMIT) return undefined;
  return `Due for decomposition: it holds ${count} increments, open and closed, more than ${ARC_SIZE_LIMIT}; ADR-1321 asks for a split into goal-scoped arcs, moving closed history with \`arc increment move\`.`;
}
