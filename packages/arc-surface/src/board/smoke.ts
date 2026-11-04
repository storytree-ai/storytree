/** Capability 3 · Arc surface. */
import type { BoardView } from "./board.js";
/** What the page drew; `folded` names the increments a strip's mark stands for, drawn without an oval or a flag (3.2). */
export interface ArcDrawn { arcs: string[]; increments: string[]; holders: { work: string; session: string; label: string }[]; folded?: string[] }
export function arcSmokeProblems(board: BoardView, drawn: ArcDrawn): string[] {
  const problems: string[] = [];
  for (const lane of board.lanes) {
    if (!drawn.arcs.includes(lane.id)) problems.push(`arc not drawn: ${lane.title}`);
    for (const bar of lane.bars) {
      if (!drawn.increments.includes(bar.id)) problems.push(`increment not drawn: ${bar.title}`);
      if (drawn.folded?.includes(bar.id)) continue;
      for (const agent of bar.agents) {
        if (!drawn.holders.some((holder) => holder.work === (agent.increment ?? agent.capability) && holder.session === agent.session && holder.label === agent.label)) problems.push(`holder not drawn: ${agent.label} on ${bar.title}`);
      }
    }
  }
  return problems;
}
