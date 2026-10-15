/**
 * Capability 14 · Ranked search (ADR-0732): `rank` orders the live artifacts by meaning, on BOTH
 * backends. The embedder is a fake that maps words to a few meanings, so "email" and "mailer" land
 * together as a real model would place them; no test loads or downloads the real model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../project/index.js";
import { SchemaRecords } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions } from "../transactions/index.js";
import { Knowledge, MemoryVectors, type Embedder, type EmbedderSource } from "./index.js";

/** Words that share a meaning; any other word is its own meaning. */
const MEANINGS: Record<string, string> = { email: "mail", mailer: "mail", mail: "mail", sender: "mail", ship: "ship", deploy: "ship", deploys: "ship", release: "ship" };
const WIDTH = 4096;

/**
 * Each meaning's axis, handed out the first time it is met and kept for every embedder this file
 * makes, so a new process reads vectors the old one kept. Never by hash: an artifact's random id
 * is embedded too, and a hash let its letters land on a question's axis (`fbdd` on `ship`).
 */
const AXES = new Map<string, number>();

function axisOf(meaning: string): number {
  let axis = AXES.get(meaning);
  if (axis === undefined) {
    axis = AXES.size;
    assert.ok(axis < WIDTH, `the fake embedder has room for ${WIDTH} meanings`);
    AXES.set(meaning, axis);
  }
  return axis;
}

/**
 * A fake embedder: each meaning is one axis of its own; it counts the texts it is asked to embed.
 * An artifact's id (`definition_46a366a7b35f`) is one word, never its letters: split, a run of `a`s
 * landed on the word "a" and outweighed a note's real words, so which note ranked first was random.
 */
function fakeEmbedder(): Embedder & { embedded: string[] } {
  const embedded: string[] = [];
  return {
    model: "fake",
    embedded,
    async embed(texts) {
      embedded.push(...texts);
      return texts.map((text) => {
        const vector = new Float32Array(WIDTH);
        for (const word of text.toLowerCase().match(/[a-z]+(?:_[0-9a-f]+)?/g) ?? []) {
          vector[axisOf(MEANINGS[word] ?? word)]! += 1;
        }
        const length = Math.hypot(...vector) || 1;
        return vector.map((value) => value / length);
      });
    },
  };
}

/**
 * The fake embedder reading only the first 512 tokens of each text, as bge-small does (transformers.js
 * drops the rest without warning). A token here is a word or a punctuation mark, with [CLS] and [SEP]
 * taking two: fewer than the real tokenizer counts, never more.
 */
function reads512Tokens(embedder: ReturnType<typeof fakeEmbedder>): Embedder {
  return {
    model: embedder.model,
    embed: (texts) => embedder.embed(texts.map((text) => (text.match(/\w+|[^\s\w]/g) ?? []).slice(0, 510).join(" "))),
  };
}

interface Opened {
  readonly knowledge: Knowledge;
  /** The records under it, to write the plan's stories, capabilities and contracts. */
  readonly records: SchemaRecords;
  /** A second library over the same store, as a new process would open it. */
  reopen(embedder: EmbedderSource): Promise<Knowledge>;
  cleanup(): Promise<void>;
}

interface Backend {
  readonly label: string;
  open(embedder: EmbedderSource): Promise<Opened>;
}

const memory: Backend = {
  label: "memory",
  async open(embedder) {
    const records = new SchemaRecords(new MemoryTransactions());
    const vectors = new MemoryVectors();
    return {
      knowledge: new Knowledge(records, undefined, { embedder, vectors }),
      records,
      reopen: async (again) => new Knowledge(records, undefined, { embedder: again, vectors }),
      cleanup: async () => {},
    };
  },
};

const postgres: Backend = {
  label: "postgres",
  async open(embedder) {
    const name = uniqueProjectName();
    const servers = [await connect({ url: testServerUrl() }, { embedder })];
    const cleanup = async (): Promise<void> => {
      try {
        for (const server of servers) await server.close();
      } finally {
        await dropTestDatabases([`storytree_${name}`]);
      }
    };
    try {
      const project = await servers[0]!.openProject(name);
      return {
        knowledge: project.knowledge,
        records: project.records,
        async reopen(again) {
          const server = await connect({ url: testServerUrl() }, { embedder: again });
          servers.push(server);
          return (await server.openProject(name)).knowledge;
        },
        cleanup,
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

for (const backend of [memory, postgres]) {
  const contract = (number: string, title: string, body: (embedder: ReturnType<typeof fakeEmbedder>, opened: Opened) => Promise<void>): void => {
    test(`${number} [${backend.label}] ${title}`, async () => {
      const embedder = fakeEmbedder();
      const opened = await backend.open(async () => embedder);
      try {
        await body(embedder, opened);
      } finally {
        await opened.cleanup();
      }
    });
  };

  contract("14.1", "rank orders artifacts by meaning, best first, finding one that shares no word with the question", async (_, { knowledge }) => {
    const deploys = await knowledge.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays." });
    const mailer = await knowledge.defineTerm({ term: "Mailer", meaning: "The mailer needs a verified sender domain." });

    const ranked = await knowledge.rank("how do I send an email");

    assert.equal(ranked.by, "meaning");
    assert.deepEqual(ranked.hits.map(({ note }) => note.id), [mailer.id, deploys.id]);
    assert.ok(ranked.hits[0]!.score! > ranked.hits[1]!.score!);
  });

  contract("14.2", "an artifact scores by its best chunk, and at most `limit` come back", async (_, { knowledge }) => {
    // Each filler is one paragraph too long to share a chunk, so the release line is a chunk of its own.
    const filler = "The forest and its islands and their trees. ".repeat(36);
    const long = await knowledge.defineTerm({ term: "Handbook", meaning: `${filler}\n\nRelease: we ship on Fridays, and we ship again on Mondays.\n\n${filler}` });
    await knowledge.defineTerm({ term: "Pricing", meaning: "Plans cost ten a month." });
    await knowledge.defineTerm({ term: "Forest", meaning: "The forest shows the plan." });

    const ranked = await knowledge.rank("when do we deploy", { limit: 1 });

    assert.deepEqual(ranked.hits.map(({ note }) => note.id), [long.id]);
  });

  contract("14.3", "an edited artifact ranks by its new words, and kept vectors are not embedded again, even by a new process", async (embedder, { knowledge, reopen }) => {
    const note = await knowledge.defineTerm({ term: "Notes", meaning: "The mailer needs a verified sender." });
    const other = await knowledge.defineTerm({ term: "Other", meaning: "Plans cost ten a month." });
    await knowledge.rank("email");

    await knowledge.editNote(note.id, { meaning: "Deploys go out on Tuesdays." });
    embedder.embedded.length = 0;
    assert.equal((await knowledge.rank("release day", { limit: 1 })).hits[0]!.note.id, note.id);
    assert.equal(embedder.embedded.length, 2, "only the edited artifact and the question are embedded");

    const again = fakeEmbedder();
    const fresh = await reopen(async () => again);
    assert.deepEqual((await fresh.rank("plans")).hits.map(({ note }) => note.id)[0], other.id);
    assert.deepEqual(again.embedded, ["plans"], "a new process reads the kept vectors");
  });

  contract("14.8", "rankAll ranks the plan's stories, capabilities and contracts by their own wording, with the artifacts", async (_, { knowledge, records }) => {
    const story = await records.create("story", { title: "Library", description: "The library keeps the plan." });
    const capability = await records.create("capability", { title: "Outbox", story: story.id, proposed: true });
    const mailer = await records.create("contract", { title: "The mailer needs a verified sender domain", capability: capability.id });
    const deploys = await knowledge.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays." });

    const ranked = await knowledge.rankAll("how do I send an email");

    assert.equal(ranked.by, "meaning");
    assert.equal(ranked.hits[0]!.note.id, mailer.id);
    assert.equal(ranked.hits[0]!.note.type, "contract");
    assert.deepEqual(new Map(ranked.hits.map(({ note }) => [note.id, note.type])), new Map([
      [story.id, "story"], [capability.id, "capability"], [mailer.id, "contract"], [deploys.id, "definition"],
    ]), "every plan kind is ranked alongside artifacts, with its own type");
  });

  contract("14.7", "a record whose title holds every word of the search, or that the search names by its contract number, ranks first", async (_, { knowledge, records }) => {
    const story = await records.create("story", { title: "Sessions" });
    const capability = await records.create("capability", { title: "Sessions list", story: story.id, proposed: true });
    const filler = "The forest and its islands and their trees. ".repeat(40);
    const strip = await records.create("contract", { title: `7.17 · ${filler} Its header hides the list: collapsed leaves only the header.`, capability: capability.id });
    await records.create("contract", { title: "7.1 · The list shows each session", capability: capability.id });
    const closer = await knowledge.defineTerm({ term: "Header", meaning: "The header is collapsed." });
    const near = await knowledge.defineTerm({ term: "Mailer", meaning: "The mailer needs a verified sender domain." });

    const byWords = await knowledge.rankAll("collapsed leaves only header", { limit: 2 });
    assert.equal(byWords.hits[0]!.note.id, strip.id, "every word is in its title, though its meaning is far off");
    assert.equal(byWords.hits[1]!.note.id, closer.id, "the rest still rank by meaning");

    assert.equal((await knowledge.rankAll("7.17 sessions caret", { limit: 1 })).hits[0]!.note.id, strip.id, "named by its number");
    assert.equal((await knowledge.rankAll("how do I send an email", { limit: 1 })).hits[0]!.note.id, near.id, "a search by meaning ranks as before");
  });

  contract("14.7", "the title lift matches whole words, a plural finding its singular, never letters inside a word", async (_, { knowledge, records }) => {
    const story = await records.create("story", { title: "Library" });
    const capability = await records.create("capability", { title: "Ranked search", story: story.id, proposed: true });
    const filler = "The forest and its islands and their trees. ".repeat(10);
    await records.create("contract", { title: `14.10 · A ranked search missing a vector ${filler}`, capability: capability.id });
    const miss = await knowledge.defineTerm({ term: "Gaps", meaning: "A ranked search miss." });
    const connecting = await knowledge.defineTerm({ term: "Connecting", meaning: `${filler} Reaching the server.` });
    const switches = await knowledge.defineTerm({ term: "Switches", meaning: "A switch is on." });
    const claim = await knowledge.defineTerm({ term: "Claim", meaning: `${filler} A session holds it.` });

    assert.equal((await knowledge.rankAll("ranked search miss", { limit: 1 })).hits[0]!.note.id, miss.id, "\"missing\" does not hold the word \"miss\"");
    const on = await knowledge.rankAll("on", { limit: 2 });
    assert.equal(on.hits[0]!.note.id, switches.id, "\"connecting\" does not hold the word \"on\"");
    assert.notEqual(on.hits[1]?.note.id, connecting.id);
    assert.equal((await knowledge.rankAll("claims switch", { limit: 1 })).hits[0]!.note.id, switches.id, "no title holds both words, so meaning decides");
    assert.equal((await knowledge.rankAll("claims", { limit: 1 })).hits[0]!.note.id, claim.id, "a plural finds its singular title");
  });

  contract("14.7", "a record whose title is the search, its contract number aside, ranks above one whose title only holds its words", async (_, { knowledge, records }) => {
    const filler = "The forest and its islands and their trees. ".repeat(10);
    const own = await knowledge.defineTerm({ term: "Edit-first curation", meaning: `${filler} Change a note before adding one.` });
    await knowledge.defineTerm({ term: "Edit-first curation steps", meaning: "Edit first: curation." });
    const story = await records.create("story", { title: "Library" });
    const capability = await records.create("capability", { title: "Ranked search", story: story.id, proposed: true });
    const numbered = await records.create("contract", { title: "14.7 · Title lift", capability: capability.id });
    await knowledge.defineTerm({ term: "Title lift notes", meaning: "Title lift, title lift." });

    assert.equal((await knowledge.rankAll("Edit-first curation", { limit: 1 })).hits[0]!.note.id, own.id);
    assert.equal((await knowledge.rankAll("edit-first  CURATION", { limit: 1 })).hits[0]!.note.id, own.id, "case and spacing aside");
    assert.equal((await knowledge.rankAll("title lift", { limit: 1 })).hits[0]!.note.id, numbered.id, "a contract's number is not part of its title");
  });

  contract("14.12", "a long note's late paragraph is embedded, so a search finds the note by what that paragraph says", async (embedder, { reopen }) => {
    const knowledge = await reopen(async () => reads512Tokens(embedder));
    await knowledge.defineTerm({ term: "Pricing", meaning: "Plans cost ten a month." });
    // About 2,900 characters and 590 tokens in all: one chunk of 3,000 would hold the release line past what the model reads.
    const sentence = "The forest and its islands and their trees. ";
    const long = await knowledge.defineTerm({ term: "Handbook", meaning: `${sentence.repeat(35)}\n\n${sentence.repeat(30)}\n\nRelease: we ship on Fridays.` });

    const ranked = await knowledge.rank("when do we deploy", { limit: 1 });

    assert.equal(ranked.hits[0]!.note.id, long.id);
    assert.ok(ranked.hits[0]!.score! > 0, "the release line was embedded");
  });

  test(`14.4 [${backend.label}] with no embedding model, rank gives the word matches and says why`, async () => {
    const opened = await backend.open(async () => {
      throw new Error("the embedding model is switched off");
    });
    try {
      const mailer = await opened.knowledge.defineTerm({ term: "Mailer", meaning: "The mailer needs a verified sender." });
      await opened.knowledge.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays." });

      const ranked = await opened.knowledge.rank("mailer");

      assert.equal(ranked.by, "words");
      assert.match(ranked.why ?? "", /switched off/);
      assert.deepEqual(ranked.hits.map(({ note }) => note.id), [mailer.id]);
    } finally {
      await opened.cleanup();
    }
  });

  test(`14.9 [${backend.label}] with no embedding model, rankAll's word matches include a contract holding the words`, async () => {
    const opened = await backend.open(async () => {
      throw new Error("the embedding model is switched off");
    });
    try {
      const story = await opened.records.create("story", { title: "Library" });
      const capability = await opened.records.create("capability", { title: "Outbox", story: story.id, proposed: true });
      const mailer = await opened.records.create("contract", { title: "The mailer needs a verified sender", capability: capability.id });
      await opened.knowledge.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays." });

      const ranked = await opened.knowledge.rankAll("mailer sender");

      assert.equal(ranked.by, "words");
      assert.match(ranked.why ?? "", /switched off/);
      assert.deepEqual(ranked.hits.map(({ note }) => note.id), [mailer.id]);
      assert.deepEqual(await opened.knowledge.rankAll(capability.id).then(({ hits }) => hits.map(({ note }) => note.id)), [], "a contract's capability is an id, not its words");
    } finally {
      await opened.cleanup();
    }
  });
}
