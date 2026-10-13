/** Capability 2 · The forest on the site. */
import React, { type CSSProperties } from "react";

/**
 * The diagram in the top left (ADR-1018 D7): a drawing, not the globe, of how a decision is kept inside it, in three beats: an
 * island seen from the side; a decision glued to its underside; the decisions it stands on, each one step deeper, a tunnel down
 * to the core. It is true to the knowledge core's placement (@storytree/knowledge-core, shelves/positions.ts): a note hangs on
 * the line from its island's entrance toward the globe's centre, at R × (1 − 0.8 d / max(deepest + 1, 5)) for its depth d, the
 * longest chain of links from the island's shelf; notes at one depth spread a little around that line; notes no shelf reaches
 * fill a ball at the centre. The beats play once over `seconds`, the line it belongs to; with reduced motion set, the CSS shows
 * the last frame still.
 */
const centre = { x: 220, y: 250 }, radius = 200, deepest = 4;
const depthAt = (depth: number) => centre.y - radius * (1 - 0.8 * depth / Math.max(deepest + 1, 5));
// Each depth's decisions, spread around the island's line as the real ones are: wider apart near the surface, closer near the centre.
const decisions = [[0], [-1, 1], [-1, 0, 1], [-1, 1]].flatMap((spread, index) => spread.map(side => ({ depth: index + 1, x: centre.x + side * 9 * (1 - index * .18), y: depthAt(index + 1) })));
// Each links to the nearest decision one step shallower: the chain of links that sets its depth.
const above = (decision: (typeof decisions)[number]) => decisions.filter(other => other.depth === decision.depth - 1)
  .reduce((best, other) => Math.abs(other.x - decision.x) < Math.abs(best.x - decision.x) ? other : best);
// The notes about no one part, loose in the core.
const loose = [[-22, -14], [14, -26], [26, 4], [-8, 12], [-30, 16], [6, -6], [18, 24], [-16, -32]];

export function DecisionsDiagram({ seconds }: { seconds: number }) {
  const [cover, ...beneath] = decisions;
  return <figure className="tour-diagram" aria-label="A drawing of how decisions are kept inside the globe" style={{ "--diagram-length": `${seconds}s` } as CSSProperties}>
    <figcaption className="tour-diagram-title">Inside the globe, drawn</figcaption>
    <svg className="tour-diagram-view" viewBox="0 0 440 300" aria-hidden="true">
      <defs>
        <radialGradient id="tour-diagram-core"><stop offset="0" stopColor="#7fb2e5" stopOpacity=".5" /><stop offset="1" stopColor="#7fb2e5" stopOpacity="0" /></radialGradient>
      </defs>
      {/* Beat 1: the globe cut through, its surface a dashed line, and one island standing on it, seen from the side. */}
      <g className="diagram-beat diagram-beat-1">
        <circle className="diagram-globe" cx={centre.x} cy={centre.y} r={radius} />
        <path className="diagram-land" d="M178 50 C184 34 200 27 220 27 C242 27 257 34 262 50 Z" />
        <path className="diagram-underside" d="M178 50 L262 50 L246 60 L232 66 L208 66 L194 60 Z" />
        {[[198, 36], [214, 31], [230, 31], [245, 38]].map(([x, y]) => <path key={x} className="diagram-tree" d={`M${x} ${y! - 13} L${x! + 6} ${y} L${x! - 6} ${y} Z`} />)}
      </g>
      {/* Beat 2: a decision glued to the island's underside. */}
      <g className="diagram-beat diagram-beat-2">
        <line className="diagram-glue" x1={cover!.x} y1={66} x2={cover!.x} y2={cover!.y} />
        <circle className="diagram-decision" cx={cover!.x} cy={cover!.y} r={6} />
      </g>
      {/* Beat 3: the decisions it stands on, one step deeper each, a tunnel down to the core and the loose notes there. */}
      <g className="diagram-beat diagram-beat-3">
        <path className="diagram-tunnel" d={`M206 66 L${centre.x - 14} ${centre.y - 46} M234 66 L${centre.x + 14} ${centre.y - 46}`} />
        <circle className="diagram-core" cx={centre.x} cy={centre.y} r={56} />
        {loose.map(([x, y], index) => <circle key={index} className="diagram-loose" cx={centre.x + x!} cy={centre.y + y!} r={3} />)}
        {beneath.map((decision, index) => <g key={index} className="diagram-deeper" style={{ "--deeper": index / beneath.length } as CSSProperties}>
          <line className="diagram-link" x1={above(decision).x} y1={above(decision).y} x2={decision.x} y2={decision.y} />
          <circle className="diagram-decision" cx={decision.x} cy={decision.y} r={5} />
        </g>)}
      </g>
    </svg>
    <p className="tour-diagram-captions">
      <span className="diagram-caption diagram-caption-1">An island: one story on the globe.</span>
      <span className="diagram-caption diagram-caption-2">A decision is glued beneath it.</span>
      <span className="diagram-caption diagram-caption-3">What it stands on goes deeper: a tunnel down to the core.</span>
    </p>
  </figure>;
}
