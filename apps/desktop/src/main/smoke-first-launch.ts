/**
 * Capability 1 · Lifecycle: what a smoke check clears from its page before the screenshot (contract 1.48). A first launch
 * opens the first-run guide in the settings menu, and offers the teaching cards' tour, over the forest; the smoke closes
 * the one and declines the other, as a person would, so its screenshot shows the forest. Closing a menu already closed does
 * nothing. Page script text, run in the page by executeJavaScript, with the page's `document` in scope.
 */
export const CLEAR_FIRST_LAUNCH = `(() => {
  document.querySelector("[data-app-close]")?.click();
  document.querySelector('[data-tour="no"]')?.click();
})()`;
