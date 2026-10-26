/**
 * Capability 1 · Home page. The claims below the framed map (ADR-1091 D1 (3), D4): one plain section per promise, a single
 * line in the owner's words (tour-copy.ts, ADR-1104 D1), each carrying its short once it is made (ADR-1104 D2): claim 1 the
 * first (PR #1571), claim 2 "one map for you and your agents", claim 3 "memory that lives where your code lives".
 */
import { escapeHtml } from "./escape-html.js";
import { fixes } from "./tour-copy.js";

/** Each claim's short, in claim order: where the built site serves it and its poster, the folder under shorts/ it was rendered into
 * (build.ts copies it from there, so the site and the render keep one copy), and what it shows, said for a screen reader. */
export const SHORTS = [
  { src: "/shorts/seeing-what-agents-built.mp4", poster: "/shorts/seeing-what-agents-built-poster.png",
    rendered: { folder: "first-short", video: "seeing-what-agents-built-1080p.mp4", poster: "seeing-what-agents-built-poster.png" },
    label: "A short film, side by side: without storytree, a developer reads the code to work out what an agent built; with storytree, they open it on the map and see its parts and which are proven." },
  { src: "/shorts/one-map-for-you-and-your-agents.mp4", poster: "/shorts/one-map-for-you-and-your-agents-poster.png",
    rendered: { folder: "one-map", video: "one-map-for-you-and-your-agents-1080p.mp4", poster: "one-map-for-you-and-your-agents-poster.png" },
    label: "A short film, side by side: without storytree, two agents pile up large changes and one rewrites a file while the developer is reviewing the other's; with storytree, the developer and both agents see each agent's claim on one map, the second waits for the part the first holds, and the change to review is small." },
  { src: "/shorts/memory-that-lives-where-your-code-lives.mp4", poster: "/shorts/memory-that-lives-where-your-code-lives-poster.png",
    rendered: { folder: "memory", video: "memory-that-lives-where-your-code-lives-1080p.mp4", poster: "memory-that-lives-where-your-code-lives-poster.png" },
    label: "A short film, side by side: without storytree, an agent tidies away why the checkout total was built the way it was, cannot say why when asked, and an old bug comes back; with storytree, the agent reads the checkout story's memory before it edits and keeps the reason, and the developer sees the story as an island on the map, its panel listing the code attached to it and the memory attached to the story." },
] as const;

const short = ({ src, poster, label }: (typeof SHORTS)[number]) => `<figure class="claim-short">
          <video src="${src}" poster="${poster}" width="1920" height="1080" muted playsinline controls preload="none" aria-label="${escapeHtml(label)}"></video>
        </figure>`;

/** The claims' markup, built into the page, so each claim reads without JavaScript. */
export function claimsMarkup(): string {
  const claims = fixes.promises.map((promise, i) => `<section class="claim" aria-labelledby="claim-${i + 1}">
        <h3 id="claim-${i + 1}" class="claim-fix">${escapeHtml(promise)}</h3>
        ${SHORTS[i] ? short(SHORTS[i]) : ""}
      </section>`).join("\n      ");
  return `<section id="claims" class="claims" aria-labelledby="claims-title">
      <h2 id="claims-title">${escapeHtml(fixes.title)}</h2>
      ${claims}
    </section>`;
}
