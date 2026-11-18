// Capability 3 · Cards and journal on screen
const centre = { x: 220, y: 250 }, radius = 200, deepest = 4;
const depthAt = (depth: number) => centre.y - radius * (1 - 0.8 * depth / Math.max(deepest + 1, 5));
const decisions = [[0], [-1, 1], [-1, 0, 1], [-1, 1]].flatMap((spread, index) => spread.map(side => ({ depth: index + 1, x: centre.x + side * 14 * (1 - index * .12), y: depthAt(index + 1) })));
const above = (decision: (typeof decisions)[number]) => decisions.filter(other => other.depth === decision.depth - 1)
  .reduce((best, other) => Math.abs(other.x - decision.x) < Math.abs(best.x - decision.x) ? other : best);
const loose = [[-22, -14], [14, -26], [26, 4], [-8, 12], [-30, 16], [6, -6], [18, 24], [-16, -32]];

export function decisionsDiagram({ seconds }: { seconds?: number } = {}): string {
  const [cover, ...beneath] = decisions;
  const timed = (property: string, value: number | string) => seconds === undefined ? "" : ` style="${property}:${value}"`;
  return `<figure class="tour-diagram" aria-label="A drawing of how decisions are kept inside the globe"${timed("--diagram-length", `${seconds}s`)}>`
    + `<figcaption class="tour-diagram-title">Inside the globe, drawn</figcaption>`
    + `<svg class="tour-diagram-view" viewBox="0 0 440 300" aria-hidden="true">`
    + `<defs><radialGradient id="tour-diagram-core"><stop offset="0" stop-color="#7fb2e5" stop-opacity=".5"></stop><stop offset="1" stop-color="#7fb2e5" stop-opacity="0"></stop></radialGradient></defs>`
    + `<g class="diagram-beat diagram-beat-1">`
    + `<circle class="diagram-globe" cx="${centre.x}" cy="${centre.y}" r="${radius}"></circle>`
    + `<path class="diagram-land" d="M178 50 C184 34 200 27 220 27 C242 27 257 34 262 50 Z"></path>`
    + `<path class="diagram-underside" d="M178 50 L262 50 L246 60 L232 66 L208 66 L194 60 Z"></path>`
    + [[198, 36], [214, 31], [230, 31], [245, 38]].map(([x, y]) => `<path class="diagram-tree" d="M${x} ${y! - 13} L${x! + 6} ${y} L${x! - 6} ${y} Z"></path>`).join("")
    + `</g>`
    + `<g class="diagram-beat diagram-beat-2">`
    + `<line class="diagram-glue" x1="${cover!.x}" y1="66" x2="${cover!.x}" y2="${cover!.y}"></line>`
    + `<circle class="diagram-decision diagram-cover" cx="${cover!.x}" cy="${cover!.y}" r="7"></circle>`
    + `</g>`
    + `<g class="diagram-beat diagram-beat-3">`
    + `<path class="diagram-tunnel" d="M200 66 L${centre.x - 20} ${centre.y - 46} M240 66 L${centre.x + 20} ${centre.y - 46}"></path>`
    + `<circle class="diagram-core" cx="${centre.x}" cy="${centre.y}" r="56"></circle>`
    + loose.map(([x, y]) => `<circle class="diagram-loose" cx="${centre.x + x!}" cy="${centre.y + y!}" r="3"></circle>`).join("")
    + beneath.map((decision, index) => `<g class="diagram-deeper"${timed("--deeper", index / beneath.length)}>`
      + `<line class="diagram-link" x1="${above(decision).x}" y1="${above(decision).y}" x2="${decision.x}" y2="${decision.y}"></line>`
      + `<circle class="diagram-decision" cx="${decision.x}" cy="${decision.y}" r="4"></circle></g>`).join("")
    + `</g></svg>`
    + `<p class="tour-diagram-captions">`
    + `<span class="diagram-caption diagram-caption-1">An island: one story on the globe.</span>`
    + `<span class="diagram-caption diagram-caption-2">A decision hangs beneath it, on its shelf: the bright dot.</span>`
    + `<span class="diagram-caption diagram-caption-3">The decisions it stands on hang deeper, the blue dots, a tunnel down to the core, where the decisions about no one story or capability gather: the pale dots.</span>`
    + `</p></figure>`;
}
