/**
 * Capability 1 · Home page. The claims below the framed map (ADR-1091 D1 (3), D4): one plain section per promise, a single
 * line in the owner's words (tour-copy.ts, ADR-1104 D1), and claim 1 carries the first short (PR #1571). Claims 2 and 3 get
 * theirs as each is made (ADR-1104 D2).
 */
import { escapeHtml } from "./escape-html.js";
import { fixes } from "./tour-copy.js";

/** Where the built site serves the first short and its poster (build.ts copies them from evidence/first-short). */
export const FIRST_SHORT = { src: "/shorts/seeing-what-agents-built.mp4", poster: "/shorts/seeing-what-agents-built-poster.png" };

const firstShort = `<figure class="claim-short">
          <video src="${FIRST_SHORT.src}" poster="${FIRST_SHORT.poster}" width="1920" height="1080" muted playsinline controls preload="none" aria-label="A short film, side by side: without storytree, a developer reads the code to work out what an agent built; with storytree, they open it on the map and see its parts and which are proven."></video>
        </figure>`;

/** The claims' markup, built into the page, so each claim reads without JavaScript. */
export function claimsMarkup(): string {
  const claims = fixes.promises.map((promise, i) => `<section class="claim" aria-labelledby="claim-${i + 1}">
        <h3 id="claim-${i + 1}" class="claim-fix">${escapeHtml(promise)}</h3>
        ${i === 0 ? firstShort : ""}
      </section>`).join("\n      ");
  return `<section id="claims" class="claims" aria-labelledby="claims-title">
      <h2 id="claims-title">${escapeHtml(fixes.title)}</h2>
      ${claims}
    </section>`;
}
