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

/** A fake embedder: each meaning is one axis (by hash); it counts the texts it is asked to embed. */
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
          const meaning = MEANINGS[word] ?? word;
          let hash = 0;
          for (const char of meaning) hash = (hash * 31 + char.charCodeAt(0)) % WIDTH;
          vector[hash]! += 1;
        }
        const length = Math.hypot(...vector) || 1;
        return vector.map((value) => value / length);
      });
    },
  };
}

interface Opened {
  readonly knowledge: Knowledge;
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
      return {
        knowledge: (await servers[0]!.openProject(name)).knowledge,
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
    const filler = "The forest and its islands and their trees. ".repeat(66);
    const long = await knowledge.defineTerm({ term: "Handbook", meaning: `${filler}\n\nRelease: we ship on Fridays.\n\n${filler}` });
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
}
