import assert from "node:assert/strict";
import { test } from "node:test";
import { feedbackText, openFeedbackDraft } from "./feedback.js";

test("5.1/5.2 opens only the reviewed title and body as a GitHub issue draft", async () => {
  const draft = { title: "A suggestion & a question?", body: "Please add 🌳\n<details> + #notes" };
  const opened: string[] = [];
  const result = await openFeedbackDraft({ ...draft, project: "private-project", logs: "private log" }, async (url) => { opened.push(url); });
  assert.equal(result.status, "opened");
  const url = new URL(opened[0]!);
  assert.equal(url.origin + url.pathname, "https://github.com/storytree-ai/storytree/issues/new");
  assert.deepEqual([...url.searchParams], [["title", draft.title], ["body", draft.body]]);
});

test("5.3 a failed handoff keeps the prepared text available and accepts an edited retry", async () => {
  const draft = { title: "Help", body: "My description" };
  const failed = await openFeedbackDraft(draft, async () => { throw new Error("No browser"); });
  assert.equal(failed.status, "failed");
  assert.equal(feedbackText(draft), "Help\n\nMy description");
  const edited = { ...draft, body: "My revised description" };
  const opened: string[] = [];
  assert.equal((await openFeedbackDraft(edited, async (url) => { opened.push(url); })).status, "opened");
  assert.equal(new URL(opened[0]!).searchParams.get("body"), edited.body);
});

test("5.2 invalid or empty drafts never reach the external opener", async () => {
  let opens = 0;
  for (const draft of [null, { title: "", body: "message" }, { title: "title", body: " " }, { title: 3, body: "message" }]) {
    await assert.rejects(() => openFeedbackDraft(draft, async () => { opens++; }));
  }
  assert.equal(opens, 0);
});
