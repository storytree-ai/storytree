/** Capability 1 · Home page. */
import { wireOpening } from "./opening.js";

// Once the intro hands over and the page beneath it has painted, the map may set up (forest.ts, 2.10).
window.addEventListener("storytree-opening", event => {
  if (!event.detail.active) requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event("storytree-arrived"))));
});
wireOpening();
const shorts = [...document.querySelectorAll<HTMLVideoElement>(".claim-short video")];
// Their wiring loads apart, so the page's first script stays within its budget (2.3).
if (shorts.length) void import("./claim-short.js").then(({ wireClaimShort }) => { for (const short of shorts) wireClaimShort(short); });
