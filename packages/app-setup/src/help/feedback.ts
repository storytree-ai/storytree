/** Capability 5 · Send feedback. */
export interface FeedbackDraft { readonly title: string; readonly body: string }
export type DraftResult = { status: "opened" } | { status: "failed"; error: string };

/** The main-process boundary accepts only user-authored title/body, never context or attachments. */
function reviewedDraft(value: unknown): FeedbackDraft {
  if (typeof value !== "object" || value === null || !("title" in value) || !("body" in value)
    || typeof value.title !== "string" || typeof value.body !== "string"
    || !value.title.trim() || !value.body.trim()) {
    throw new Error("Add a title and a message before opening the draft.");
  }
  return { title: value.title, body: value.body };
}

export function feedbackText(draft: FeedbackDraft): string { return `${draft.title}\n\n${draft.body}`; }

/** A successful OS handoff proves only that we opened a draft, never that GitHub received feedback. */
export async function openFeedbackDraft(value: unknown, openExternal: (url: string) => Promise<void>): Promise<DraftResult> {
  const draft = reviewedDraft(value);
  const url = new URL("https://github.com/storytree-ai/storytree/issues/new");
  url.searchParams.set("title", draft.title);
  url.searchParams.set("body", draft.body);
  try {
    await openExternal(url.href);
    return { status: "opened" };
  } catch {
    return { status: "failed", error: "The browser draft could not be opened. Retry or copy your prepared text." };
  }
}

/** What the app says once the handoff is done: a draft was opened, never that feedback was received. */
export function draftSaid(result: DraftResult): string {
  return result.status === "opened" ? "Opened a draft in your browser. Review it on GitHub and submit it yourself." : result.error;
}
