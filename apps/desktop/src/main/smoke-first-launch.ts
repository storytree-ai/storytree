// Capability 1 · Lifecycle
export const CLEAR_FIRST_LAUNCH = `(() => {
  document.querySelector("[data-app-close]")?.click();
  document.querySelector('[data-tour="no"]')?.click();
})()`;
