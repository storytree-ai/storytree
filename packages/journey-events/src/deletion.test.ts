import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteJourneyEvents } from "./deletion.js";

const personId = "095be615-a8ad-4c33-8e9c-c7612fbf6c9f";
const credentials = { projectId: "1234", personalKey: "phx_test_secret", distinctId: "install_0123456789abcdef" };

function person(distinctIds = [credentials.distinctId]) {
  return { id: personId, uuid: personId, distinct_ids: distinctIds };
}

test("4.2 administrator requests only the matching EU person's events and reports queued, never erased", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await deleteJourneyEvents({
    ...credentials,
    fetch: async (url, init) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      if (calls.length === 1) return Response.json({ next: null, results: [person()] });
      return Response.json({ persons_found: 1, persons_queued_for_deletion: 1, persons_deleted: 0, events_queued_for_deletion: true, deletion_errors: [] }, { status: 202 });
    },
  });
  assert.deepEqual(result, { status: "requested" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, `https://eu.posthog.com/api/projects/1234/persons/?distinct_id=${credentials.distinctId}`);
  assert.equal(calls[1]!.url, "https://eu.posthog.com/api/projects/1234/persons/bulk_delete/");
  assert.deepEqual(JSON.parse(calls[1]!.init!.body as string), { ids: [personId], delete_events: true });
  for (const call of calls) {
    assert.equal(new Headers(call.init!.headers).get("Authorization"), "Bearer phx_test_secret");
    assert.equal(call.init!.redirect, "error");
  }
});

test("4.2 missing authorization makes no request and absent person does not claim erasure", async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ next: null, results: [] });
  };
  await assert.rejects(deleteJourneyEvents({ ...credentials, personalKey: "", fetch }), { message: "Journey event deletion unavailable" });
  assert.equal(calls, 0);
  assert.deepEqual(await deleteJourneyEvents({ ...credentials, fetch }), { status: "not-found" });
  assert.equal(calls, 1);
});

test("4.2 administrator refuses ambiguous or malformed matches before deletion", async () => {
  for (const body of [
    { next: null, results: [person(), person()] },
    { next: "https://eu.posthog.com/more", results: [person()] },
    { next: null, results: [person(["somebody_else"])] },
    { next: null, results: [{ distinct_ids: [credentials.distinctId], uuid: "invalid" }] },
    { next: null, unexpected: [] },
  ]) {
    let calls = 0;
    await assert.rejects(deleteJourneyEvents({
      ...credentials,
      fetch: async () => { calls += 1; return Response.json(body); },
    }), { message: "Journey event deletion unavailable" });
    assert.equal(calls, 1);
  }
});

test("4.2 vendor failures never expose the personal key or claim deletion success", async () => {
  for (const response of [
    Response.json({ error: credentials.personalKey }, { status: 401 }),
    Response.json({ persons_found: 1, persons_queued_for_deletion: 0, persons_deleted: 0, events_queued_for_deletion: false, deletion_errors: [] }, { status: 202 }),
    Response.json({ persons_found: 1, persons_queued_for_deletion: 1, events_queued_for_deletion: true, deletion_errors: [{ error: credentials.personalKey }] }, { status: 202 }),
  ]) {
    let calls = 0;
    await assert.rejects(deleteJourneyEvents({ ...credentials, fetch: async () => ++calls === 1 ? Response.json({ next: null, results: [person()] }) : response }), { message: "Journey event deletion unavailable" });
  }
  await assert.rejects(deleteJourneyEvents({ ...credentials, fetch: async () => { throw new Error(credentials.personalKey); } }), { message: "Journey event deletion unavailable" });
});
