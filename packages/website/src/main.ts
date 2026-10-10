/** Capability 1 · Home page. */
import { wireWaitlist } from "./waitlist.js";
import { wireOpening } from "./opening.js";

const chapter = document.querySelector<HTMLElement>("#chapter2");
let tourRequested = false;
const loadTour = () => {
  if (tourRequested || !chapter) return;
  tourRequested = true;
  void import("./tour-ui.js").then(({ wireTour }) => wireTour()).catch(() => { tourRequested = false; });
};
window.addEventListener("storytree-opening", event => {
  if (!event.detail.active) loadTour();
});
wireOpening();
if (chapter) {
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect(); loadTour();
    });
    observer.observe(chapter);
  } else loadTour();
}
const form = document.querySelector<HTMLFormElement>("#waitlist-form");
if (form) wireWaitlist(form);
