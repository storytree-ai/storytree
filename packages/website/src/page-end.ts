/**
 * Capability 1 · Home page. The page's end (ADR-1091 D1 (4), (5)): the owner's harness line with the marks of the harnesses
 * storytree watches, then the closing call as the last thing on the page: following the build on GitHub, in the live and
 * preview builds alike, since storytree.dev has no waitlist (ADR-1166). No sticky header and no testimonials (D1).
 */
import { escapeHtml } from "./escape-html.js";
import { harness } from "./tour-copy.js";

/**
 * The live page's closing call (the owner, 2026-10-25): follow the build in the open, said plainly to be early alpha,
 * rather than an invitation to install it.
 */
export const liveCall = {
  title: "Follow the build.",
  line: "Storytree is in early alpha and not ready for use yet. It’s open source, and built in the open on GitHub.",
  href: "https://github.com/storytree-ai/storytree",
  label: "Follow the build on GitHub",
};

/** The harness section and the closing call, built into the page so both read without JavaScript. */
export function pageEndMarkup(): string {
  const marks = harness.marks.map(({ name, src }) => `<li><img src="${src}" alt="${escapeHtml(name)}" width="40" height="40"><span aria-hidden="true">${escapeHtml(name)}</span></li>`).join("");
  return `<section id="harness" class="page-end harness" aria-labelledby="harness-title">
      <h2 id="harness-title">${escapeHtml(harness.title)}</h2>
      <p class="harness-claim">${escapeHtml(harness.claim)}</p>
      <p class="harness-why">${escapeHtml(harness.why)}</p>
      <ul class="harness-marks">${marks}</ul>
      <p class="harness-note">${escapeHtml(harness.marksNote)}</p>
    </section>
    <section id="call" class="page-end call" aria-labelledby="call-title">
      <h2 id="call-title">${escapeHtml(liveCall.title)}</h2>
      <p class="call-line">${escapeHtml(liveCall.line)}</p>
      <p class="call-do"><a id="call-action" class="call-action" href="${liveCall.href}">${escapeHtml(liveCall.label)} <span aria-hidden="true">→</span></a></p>
    </section>`;
}
