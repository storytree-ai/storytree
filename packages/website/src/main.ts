/** Capability 1 · Home page. */
import { wireWaitlist } from "./waitlist.js";
import { wireOpening } from "./opening.js";

// Once the intro hands over and the page beneath it has painted, the map may set up (forest.ts, 2.10).
window.addEventListener("storytree-opening", event => {
  if (!event.detail.active) requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event("storytree-arrived"))));
});
wireOpening();
const form = document.querySelector<HTMLFormElement>("#waitlist-form");
if (form) wireWaitlist(form);
const short = document.querySelector<HTMLVideoElement>(".claim-short video");
// Its wiring loads apart, so the page's first script stays within its budget (2.3).
if (short) void import("./claim-short.js").then(({ wireClaimShort }) => wireClaimShort(short));
