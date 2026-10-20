/**
 * Capability 1 · Home page. The page's end (ADR-1091 D1 (4), (5)): below the claims, the owner's harness line with the marks
 * of the harnesses storytree watches, then the waitlist as the last thing on the page. The call is one object, so the install
 * one-liner can take its place when one exists. No sticky header and no testimonials (D1).
 */
import { escapeHtml } from "./escape-html.js";
import { harness } from "./tour-copy.js";

/** The page's closing call: today the waitlist, later the install one-liner. */
export const call = {
  title: "Join the waitlist.",
  line: "Leave your email, and we’ll let you know when your invitation is ready.",
  href: "/waitlist.html",
  label: "Join the waitlist",
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
      <h2 id="call-title">${escapeHtml(call.title)}</h2>
      <p class="call-line">${escapeHtml(call.line)}</p>
      <p class="call-do"><a id="call-action" class="call-action" href="${call.href}">${escapeHtml(call.label)} <span aria-hidden="true">→</span></a></p>
    </section>`;
}
