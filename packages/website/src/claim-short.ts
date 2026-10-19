/** Capability 1 · Home page. The page's side of claim 1's short (claims.ts builds its markup), loaded by main.ts once the page has the video, so the page's first script stays small (contract 2.3). */

/**
 * The first short plays, muted, while it is in view and pauses when it leaves. With reduced motion it stays on its poster
 * until the visitor plays it with its controls; it still pauses when it leaves the view, but is never started for them.
 */
export function wireClaimShort(video: HTMLVideoElement, view: Window & typeof globalThis = window): () => void {
  const still = view.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const observer = new view.IntersectionObserver(entries => {
    const seen = entries.at(-1)?.isIntersecting === true;
    if (seen && !still) void video.play().catch(() => {});
    else if (!seen && !video.paused) video.pause();
  }, { threshold: 0.5 });
  observer.observe(video);
  return () => observer.disconnect();
}
