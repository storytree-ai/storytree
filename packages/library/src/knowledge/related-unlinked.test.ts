/**
 * Capability 6 · Knowledge artifacts, grown by ADR-0654: contract 6.10 in the library story, the
 * related-but-unlinked search 0.2's librarian used for its Links round, and 6.11, the same and search()
 * asked many times from one reading, run on BOTH backends, as 6.1-6.7 are (knowledge-memory.test.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../project/index.js";
import { SchemaRecords } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type Transactions } from "../transactions/index.js";
import { Knowledge } from "./index.js";

interface Library {
  readonly knowledge: Knowledge;
  readonly records: SchemaRecords;
  readonly transactions: Transactions;
  cleanup(): Promise<void>;
}

interface Backend {
  readonly label: string;
  open(): Promise<Library>;
}

const memory: Backend = {
  label: "memory",
  async open() {
    const transactions = new MemoryTransactions();
    const records = new SchemaRecords(transactions);
    return { knowledge: new Knowledge(records), records, transactions, cleanup: async () => {} };
  },
};

const postgres: Backend = {
  label: "postgres",
  async open() {
    const name = uniqueProjectName();
    const storytree = await connect({ url: testServerUrl() });
    const cleanup = async (): Promise<void> => {
      try {
        await storytree.close();
      } finally {
        await dropTestDatabases([`storytree_${name}`]);
      }
    };
    try {
      const project = await storytree.openProject(name);
      return { knowledge: project.knowledge, records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

for (const backend of [memory, postgres]) {
  const contract = (number: string, title: string, body: (library: Library) => Promise<void>): void => {
    test(`${number} [${backend.label}] ${title}`, async () => {
      const library = await backend.open();
      try {
        await body(library);
      } finally {
        await library.cleanup();
      }
    });
  };

  contract("6.10", "related ranks the other artifacts by likeness to one, saying of each whether a link joins them either way; unlinked shows only those no link reaches", async ({ knowledge, records, transactions }) => {
    const source = await knowledge.writeKnowledge("principle", {
      title: "Confirmation email bounces",
      description: "Mailgun bounces the sign-up confirmation email when the domain is unverified",
      statement: "An unverified mailgun domain bounces confirmation email",
      why: "Visitors never receive their confirmation",
      howToApply: "Verify the domain first",
    });
    // About the same thing: one the source's own links will reach, one that links to the source,
    // one nothing connects, and one that shares a single word.
    const linkedOut = await knowledge.defineTerm({ term: "Verified domain", meaning: "A mailgun domain whose confirmation email does not bounce" });
    await knowledge.editNote(source.id, { links: [linkedOut.id] });
    const linkedIn = await knowledge.writeKnowledge("pattern", {
      title: "Retry bounced confirmation email",
      description: "When mailgun bounces a confirmation email, retry after verifying the domain",
      statement: "Retry a bounced confirmation email",
      problem: "Mailgun bounced it",
      approach: "Verify the domain, then retry",
      links: [source.id],
    });
    const unlinked = await knowledge.recordDecision({
      status: "accepted",
      title: "Verify the mailgun domain before launch",
      text: "Unverified domains make mailgun bounce every sign-up confirmation email.",
    });
    const faint = await knowledge.defineTerm({ term: "Launch", meaning: "The day visitors first see the site, after the domain is bought" });
    const stranger = await knowledge.defineTerm({ term: "Planet", meaning: "The forest drawn as a globe" });

    const history = await transactions.history();
    const all = await knowledge.related(source.id);
    assert.ok(all !== null);
    assert.equal(all.source, source.id);
    assert.ok(all.terms.includes("mailgun"), `the source's own distinguishing words: ${all.terms.join(", ")}`);
    assert.equal(all.scanned, 5, "every other live artifact was ranked");
    const ids = all.hits.map(({ id }) => id);
    assert.ok(!ids.includes(source.id), "never itself");
    assert.ok(!ids.includes(stranger.id), "an artifact sharing no word is not listed");
    for (const id of [linkedOut.id, linkedIn.id, unlinked.id]) assert.ok(ids.includes(id), `${id} is related`);
    assert.ok(ids.indexOf(unlinked.id) < ids.indexOf(faint.id), "the closer match ranks higher");
    assert.equal(all.linkedCount, 2);
    const byId = new Map(all.hits.map((hit) => [hit.id, hit]));
    assert.deepEqual(byId.get(linkedOut.id)?.linkVia, ["links"], "the source links to it");
    assert.deepEqual(byId.get(linkedIn.id)?.linkVia, ["links → this"], "it links to the source");
    assert.equal(byId.get(unlinked.id)?.linked, false);
    assert.equal(byId.get(unlinked.id)?.title, "Verify the mailgun domain before launch");
    assert.equal(byId.get(unlinked.id)?.type, "decision");

    const only = await knowledge.related(source.id, { unlinked: true });
    assert.deepEqual(only?.hits.map(({ id }) => id).filter((id) => id !== faint.id), [unlinked.id], "only what no link reaches");
    assert.equal(only?.linkedCount, 2, "counted over the whole ranking");
    assert.deepEqual((await knowledge.related(source.id, { unlinked: true, limit: 1 }))?.hits.map(({ id }) => id), [unlinked.id]);
    assert.deepEqual((await knowledge.related(source.id, { kind: "decision" }))?.hits.map(({ id }) => id), [unlinked.id], "one kind only");

    // Once linked, it leaves the unlinked list; a retired artifact is never ranked.
    await knowledge.editNote(unlinked.id, { links: [source.id] });
    assert.ok(!(await knowledge.related(source.id, { unlinked: true }))?.hits.some(({ id }) => id === unlinked.id));
    await records.retire(linkedIn.id, "merged");
    assert.ok(!(await knowledge.related(source.id))?.hits.some(({ id }) => id === linkedIn.id));

    assert.equal(await knowledge.related("principle_000000000000"), null, "null for no artifact");
    const story = await records.create("story", { title: "Mailgun sign-up" });
    assert.equal(await knowledge.related(story.id), null, "a story is not an artifact");
    assert.equal((await transactions.history()).length, history.length + 3, "only the three writes above were written: the reads wrote nothing");
  });

  contract("6.11", "searchEach and relatedEach answer as search and related would for each, in order, from one reading of the artifacts; relatedEach leaves out an id that is no live artifact", async ({ knowledge, records }) => {
    const source = await knowledge.writeKnowledge("principle", { title: "Confirmation email bounces", description: "Mailgun bounces the confirmation email", statement: "An unverified mailgun domain bounces email", why: "No confirmation arrives", howToApply: "Verify the domain first" });
    const other = await knowledge.recordDecision({ status: "accepted", title: "Verify the mailgun domain", text: "Unverified domains bounce every confirmation email." });
    await knowledge.defineTerm({ term: "Planet", meaning: "The forest drawn as a globe" });
    const story = await records.create("story", { title: "Mailgun sign-up" });

    const list = records.list.bind(records);
    let reads = 0;
    records.list = ((...args: Parameters<typeof list>) => {
      reads += 1;
      return list(...args);
    }) as typeof records.list;
    await knowledge.search("mailgun");
    const one = reads;

    reads = 0;
    const queries = ["mailgun", "globe", "nothing-holds-this", "verify domain"];
    const found = await knowledge.searchEach(queries);
    assert.equal(reads, one, "four searches read the artifacts once, as one search does");
    records.list = list;
    assert.deepEqual(found, await Promise.all(queries.map((query) => knowledge.search(query))));

    records.list = ((...args: Parameters<typeof list>) => {
      reads += 1;
      return list(...args);
    }) as typeof records.list;
    reads = 0;
    const related = await knowledge.relatedEach([source.id, story.id, other.id], { unlinked: true });
    assert.equal(reads, one, "related for two artifacts reads them once");
    records.list = list;
    assert.deepEqual(related, [await knowledge.related(source.id, { unlinked: true }), await knowledge.related(other.id, { unlinked: true })], "in order, the story left out");
  });
}
