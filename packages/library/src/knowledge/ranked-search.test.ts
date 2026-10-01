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

/** A fake embedder: each meaning is one axis of its own; it counts the texts it is asked to embed. */
function fakeEmbedder(): Embedder & { embedded: string[] } {
  const embedded: string[] = [];
  return {
    model: "fake",
    embedded,
    async embed(texts) {
      embedded.push(...texts);
      return texts.map((text) => {
        const vector = new Float32Array(WIDTH);
        for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
          vector[axisOf(MEANINGS[word] ?? word)]! += 1;
        }
        const length = Math.hypot(...vector) || 1;
        return vector.map((value) => value / length);
      });
    },
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
    const filler = "The forest and its islands and their trees. ".repeat(67);
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

  contract("14.5", "rankAll ranks the plan's stories, capabilities and contracts by their own wording, with the artifacts", async (_, { knowledge, records }) => {
    const story = await records.create("story", { title: "Library", description: "The library keeps the plan." });
    const capability = await records.create("capability", { title: "Outbox", story: story.id, proposed: true });
    const mailer = await records.create("contract", { title: "The mailer needs a verified sender domain", capability: capability.id });
    const deploys = await knowledge.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays." });

    const ranked = await knowledge.rankAll("how do I send an email");

    assert.equal(ranked.hits[0]!.note.id, mailer.id);
    assert.equal(ranked.hits[0]!.note.type, "contract");
    assert.ok(ranked.hits.some(({ note }) => note.id === deploys.id), "the artifacts are ranked too");
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

  test(`14.6 [${backend.label}] with no embedding model, rankAll's word matches include a contract holding the words`, async () => {
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
      assert.deepEqual(ranked.hits.map(({ note }) => note.id), [mailer.id]);
      assert.deepEqual(await opened.knowledge.rankAll(capability.id).then(({ hits }) => hits.map(({ note }) => note.id)), [], "a contract's capability is an id, not its words");
    } finally {
      await opened.cleanup();
    }
  });
}
