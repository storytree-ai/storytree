import type { BoardView } from "./board.js";
export interface ArcDrawn { arcs: string[]; increments: string[]; holders: { work: string; session: string; label: string }[] }
export function arcSmokeProblems(board: BoardView, drawn: ArcDrawn): string[] {
  const problems: string[] = [];
  for (const lane of board.lanes) {
    if (!drawn.arcs.includes(lane.id)) problems.push(`arc not drawn: ${lane.title}`);
    for (const bar of lane.bars) {
      if (!drawn.increments.includes(bar.id)) problems.push(`increment not drawn: ${bar.title}`);
      for (const agent of bar.agents) {
        if (!drawn.holders.some((holder) => holder.work === (agent.increment ?? agent.capability) && holder.session === agent.session && holder.label === agent.label)) problems.push(`holder not drawn: ${agent.label} on ${bar.title}`);
      }
    }
  }
  return problems;
}
