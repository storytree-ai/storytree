/**
 * Unclaimed work beside the forest (stories/forest.md, capability 6): a count always in view, and
 * on request the list of edits and commands made while holding no claim, newest first, with who
 * made them, which files and when. It names no story, since storytree cannot know which it belongs
 * to. Every word from the log is written as text, never as HTML.
 */
import type { UnclaimedWork } from "@storytree/forest";

/** The box's HTML: `open` keeps the list showing across redraws. */
export function renderUnclaimed(work: UnclaimedWork, open: boolean): string {
  const rows = work.entries
    .slice(0, 200)
    .map(
      (entry) => `
        <li>
          <span class="unclaimed-who">${text(entry.agent)}</span>
          <time datetime="${text(entry.at)}">${text(when(entry.at))}</time>
          <span class="unclaimed-what">${entry.command === undefined ? entry.files.map((file) => `<code>${text(file)}</code>`).join(" ") : `ran <code>${text(entry.command)}</code>`}</span>
        </li>`,
    )
    .join("");
  return `
    <details${open ? " open" : ""}>
      <summary>Unclaimed work <span class="unclaimed-count">${work.count}</span></summary>
      ${work.count === 0
        ? `<p class="panel-muted">Nothing done outside a claim.</p>`
        : `<p class="panel-muted">Edits and commands made while holding no claim. Storytree can't tell which story they belong to.</p><ol>${rows}</ol>`}
    </details>`;
}

function when(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
