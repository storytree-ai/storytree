/** Capability 1 · Home page. The page's side of the claims' shorts (claims.ts builds their markup), loaded by main.ts once the page has a video, so the page's first script stays small (contract 2.3). */

/**
 * A claim's short plays, muted, while at least half of it is in view and pauses when it leaves. With reduced motion it stays on its poster
 * until the visitor plays it with its controls; it still pauses when it leaves the view, but is never started for them.
 */
export function wireClaimShort(video: HTMLVideoElement, view: Window & typeof globalThis = window): () => void {
  const still = view.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const observer = new view.IntersectionObserver(entries => {
    // Seen while at least half of it is in view: an entry still intersecting by a sliver has left.
    const last = entries.at(-1), seen = last?.isIntersecting === true && last.intersectionRatio >= 0.5;
    if (seen && !still) void video.play().catch(() => {});
    else if (!seen && !video.paused) video.pause();
  }, { threshold: 0.5 });
  observer.observe(video);
  return () => observer.disconnect();
}
