import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../../projects/open/index.js";
import { SchemaRecords } from "../../storage/rules/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../../testing/pg.js";
import { MemoryTransactions } from "../../storage/store/index.js";
import { Knowledge } from "../notes/index.js";
import { MemoryVectors, type Embedder, type EmbedderSource } from "./index.js";

const MEANINGS: Record<string, string> = { email: "mail", mailer: "mail", mail: "mail", sender: "mail", ship: "ship", deploy: "ship", deploys: "ship", release: "ship" };
const WIDTH = 4096;

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

function fakeEmbedder(): Embedder & { embedded: string[] } {
  const embedded: string[] = [];
  return {
    model: "fake",
    embedded,
    async embed(texts) {
      embedded.push(...texts);
      return texts.map((text) => {
        const vector = new Float32Array(WIDTH);
        for (const word of text.toLowerCase().replace(/\b[a-z]+_[0-9a-f]{12}\b/g, " ").match(/[a-z]+/g) ?? []) {
          vector[axisOf(MEANINGS[word] ?? word)]! += 1;
        }
        const length = Math.hypot(...vector) || 1;
        return vector.map((value) => value / length);
      });
    },
  };
}

function reads512Tokens(embedder: ReturnType<typeof fakeEmbedder>): Embedder {
  return {
    model: embedder.model,
    embed: (texts) => embedder.embed(texts.map((text) => (text.match(/\w+|[^\s\w]/g) ?? []).slice(0, 510).join(" "))),
  };
}

interface Opened {
  readonly knowledge: Knowledge;
  readonly records: SchemaRecords;
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
    const miss = await knowledge.defineTerm({ term: "Gaps", meaning: "A ranked search miss: the ranked search missed what was asked." });
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

  contract("14.16", "the patterns a ranked search compiles do not grow with the records it ranks", async (_, { knowledge }) => {
    const compiledBy = async (search: () => Promise<unknown>): Promise<number> => {
      const original = globalThis.RegExp;
      let compiled = 0;
      globalThis.RegExp = new Proxy(original, { construct: (target, args, newTarget) => ((compiled += 1), Reflect.construct(target, args, newTarget)) });
      try {
        await search();
      } finally {
        globalThis.RegExp = original;
      }
      return compiled;
    };
    const define = async (names: readonly string[]): Promise<void> => {
      for (const name of names) await knowledge.defineTerm({ term: `${name} release`, meaning: `The ${name.toLowerCase()} release ships.` });
    };
    await define(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);
    const few = await compiledBy(() => knowledge.rankAll("release train", { limit: 1 }));

    await define(["Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo"]);
    const many = await compiledBy(() => knowledge.rankAll("release train", { limit: 1 }));

    assert.equal(many, few, "three times the records and title words, the same patterns compiled");
  });

  contract("14.18", "rankAll ranks current state unless told: resteers, friction and superseded decisions come back with history, a resteer or friction when its kind is named, and a decision superseded in part (clause-scoped, or a narrows not yet moved) names the decisions that supersede its clauses, and the clauses each names", async (_, { knowledge, records }) => {
    const old = await knowledge.recordDecision({ status: "accepted", title: "Email through Mailgun", text: "Every email goes through Mailgun." });
    const successor = await knowledge.recordDecision({ status: "accepted", title: "Email through Postmark", text: "Every email goes through Postmark.", supersedes: [old.id], justifications: { [old.id]: "It replaces the earlier rule." } });
    const narrowed = await knowledge.recordDecision({ status: "accepted", title: "Email the sender", text: "The sender gets an email copy." });
    const narrowing = await knowledge.recordDecision({ status: "accepted", title: "Email copies are opt-in", text: "A sender asks for an email copy.", supersedesClauses: [{ decision: narrowed.id, clauses: ["D2"] }], justifications: { [narrowed.id]: "It replaces the earlier rule's D2." } });
    const partly = await knowledge.recordDecision({ status: "accepted", title: "Email receipts", text: "Every receipt goes by email." });
    const legacy = await records.create("decision", { status: "accepted", title: "Email receipts are printed too", text: "A receipt is printed beside its email.", narrows: [partly.id] });
    const resteer = await knowledge.writeKnowledge("resteer", {
      title: "Not Mailgun email", description: "The owner redirected the mailer.", doing: "Wiring Mailgun email", redirect: "Use Postmark for email",
      evidence: "He said: email goes through Postmark.", disposition: "taste", dispositionBy: "owner",
    });
    const friction = await knowledge.writeKnowledge("friction", {
      title: "Email bounced", description: "A test email bounced.", statement: "Mailgun bounced an email.", evidence: "403 on send.", impact: "No email arrives.",
    });
    const ids = async (options: Parameters<Knowledge["rankAll"]>[1]): Promise<Set<string>> =>
      new Set((await knowledge.rankAll("email", { limit: 20, ...options })).hits.map(({ note }) => note.id));
    const decisions = [successor.id, narrowed.id, narrowing.id, partly.id, legacy.id];

    assert.deepEqual(await ids({}), new Set(decisions), "current state only");
    assert.deepEqual(await ids({ history: true }), new Set([old.id, ...decisions, resteer.id, friction.id]), "history brings the rest back");
    assert.deepEqual(await ids({ kinds: ["resteer", "friction"] }), new Set([resteer.id, friction.id]), "a named history kind is ranked");
    assert.deepEqual(await ids({ kinds: ["decision"] }), new Set(decisions), "a superseded decision needs history");
    assert.deepEqual(await ids({ kinds: ["decision"], history: true }), new Set([old.id, ...decisions]));

    const hits = (await knowledge.rankAll("email", { limit: 20 })).hits;
    assert.deepEqual(hits.find(({ note }) => note.id === narrowed.id)?.narrowedBy, [{ id: narrowing.id, number: narrowing.fields.number, clauses: ["D2"] }]);
    assert.deepEqual(hits.find(({ note }) => note.id === partly.id)?.narrowedBy, [{ id: legacy.id }], "a narrows not yet moved reads as partial");
    assert.ok(hits.filter(({ note }) => note.id !== narrowed.id && note.id !== partly.id).every(({ narrowedBy }) => narrowedBy === undefined), "only the decisions superseded in part are marked");
    await assert.rejects(knowledge.rankAll("email", { kinds: ["question" as "story"] }), /unknown kind to search: question/);
  });

  contract("14.19", "rankAll finds an arc by its title, intent or end state and an increment by its title, objective or body, each ranked under its own type with the rest", async (_, { knowledge, records }) => {
    const story = await records.create("story", { title: "Library", description: "The library keeps the plan." });
    const deploys = await knowledge.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays." });
    const arc = await records.create("arc", { title: "Outbox", intent: "Visitors pay by invoice.", endState: "Every receipt is archived." });
    const increment = await records.create("increment", { arc: arc.id, title: "Ledger", objective: "Refunds reach the customer.", body: "Chargebacks are disputed.", status: "active" });

    for (const [query, id] of [
      ["outbox", arc.id], ["invoice", arc.id], ["receipt archived", arc.id],
      ["ledger", increment.id], ["refunds customer", increment.id], ["chargebacks disputed", increment.id],
    ] as const) {
      const ranked = await knowledge.rankAll(query);
      assert.equal(ranked.by, "meaning");
      assert.equal(ranked.hits[0]?.note.id, id, `"${query}" finds ${id} first`);
    }
    assert.deepEqual(new Map((await knowledge.rankAll("invoice", { limit: 20 })).hits.map(({ note }) => [note.id, note.type])), new Map<string, string>([
      [story.id, "story"], [deploys.id, "definition"], [arc.id, "arc"], [increment.id, "increment"],
    ]), "arcs and increments are ranked alongside the rest, with their own type");
  });

  contract("14.19", "a kind naming arc or increment narrows rankAll to that kind, closed ones included, and naming both gives both", async (_, { knowledge, records }) => {
    const story = await records.create("story", { title: "Invoices", description: "Invoice refunds." });
    const term = await knowledge.defineTerm({ term: "Refunds", meaning: "Invoice refunds go out monthly." });
    const open = await records.create("arc", { title: "Invoice refunds", intent: "Invoice refunds are issued.", endState: "Invoice refunds are settled." });
    const done = await records.create("arc", { title: "Refund paperwork", intent: "Invoice refunds are filed.", endState: "Invoice refunds are stamped." });
    const active = await records.create("increment", { arc: open.id, title: "Invoice refunds", objective: "Invoice refunds are issued.", body: "Invoice refunds.", status: "active" });
    const closed = await records.create("increment", {
      arc: done.id, title: "Refund filing", objective: "Invoice refunds are filed.", body: "Invoice refunds.", status: "closed", outcome: { date: "2026-11-19", pr: "#1", disposition: "landed" },
    });
    const ids = async (kinds: NonNullable<NonNullable<Parameters<Knowledge["rankAll"]>[1]>["kinds"]>): Promise<Set<string>> =>
      new Set((await knowledge.rankAll("invoice refunds", { limit: 20, kinds })).hits.map(({ note }) => note.id));

    assert.deepEqual(await ids(["arc"]), new Set([open.id, done.id]));
    assert.deepEqual(await ids(["increment"]), new Set([active.id, closed.id]));
    assert.deepEqual(await ids(["arc", "increment"]), new Set([open.id, done.id, active.id, closed.id]));
    assert.deepEqual(await ids(["story", "definition"]), new Set([story.id, term.id]), "naming other kinds leaves arcs and increments out");
  });

  contract("14.19", "a closed increment, and an arc whose increments are all closed with no open question, rank after every open record, however well they match; within each group the meaning order holds", async (_, { knowledge, records }) => {
    const wording = { title: "Invoice refunds", intent: "Invoice refunds are issued.", endState: "Invoice refunds are settled." };
    const landed = { status: "closed", outcome: { date: "2026-11-19", pr: "#1", disposition: "landed" } } as const;
    const paperwork = (arc: string, status: "closed" | "active") =>
      records.create("increment", { arc, title: "Paperwork", objective: "Paperwork is filed.", body: "Paperwork is stamped.", ...(status === "closed" ? landed : { status }) });
    const question = (arc: string, settled: boolean) =>
      records.create("question", {
        arc, title: "Which paper", stakes: "Paperwork.", statement: "Which paper?", context: "Paperwork.", options: "Blue or green.",
        ...(settled ? { lifecycle: "settled", answer: "Blue.", settledAt: "2026-11-19T00:00:00.000Z" } : { lifecycle: "open" }),
      });

    const note = await knowledge.defineTerm({ term: "Billing", meaning: "Refunds go out monthly." });
    const arcDone = await records.create("arc", wording);
    const incrementDone = await records.create("increment", { arc: arcDone.id, title: "Invoice refunds", objective: "Invoice refunds are issued.", body: "Invoice refunds are settled.", ...landed });
    const arcSettled = await records.create("arc", wording);
    const settledPaper = await paperwork(arcSettled.id, "closed");
    await question(arcSettled.id, true);
    const arcAsking = await records.create("arc", wording);
    const askingPaper = await paperwork(arcAsking.id, "closed");
    await question(arcAsking.id, false);
    const arcEmpty = await records.create("arc", wording);
    const arcBusy = await records.create("arc", wording);
    const busyPaper = await paperwork(arcBusy.id, "closed");
    const busyActive = await paperwork(arcBusy.id, "active");

    const hits = (await knowledge.rankAll("invoice refunds", { limit: 50 })).hits.map(({ note: found }) => found.id);
    const groups = [
      [arcAsking.id, arcEmpty.id, arcBusy.id],
      [note.id],
      [busyActive.id],
      [arcDone.id, incrementDone.id, arcSettled.id],
      [settledPaper.id, askingPaper.id, busyPaper.id],
    ];
    assert.equal(hits.length, groups.flat().length, "every record is ranked");
    let start = 0;
    for (const group of groups) {
      assert.deepEqual(new Set(hits.slice(start, start + group.length)), new Set(group), `positions ${start} to ${start + group.length - 1} of ${JSON.stringify(hits)}`);
      start += group.length;
    }
  });

  contract("14.12", "a long note's late paragraph is embedded, so a search finds the note by what that paragraph says", async (embedder, { reopen }) => {
    const knowledge = await reopen(async () => reads512Tokens(embedder));
    await knowledge.defineTerm({ term: "Pricing", meaning: "Plans cost ten a month." });
    const sentence = "The forest and its islands and their trees. ";
    const long = await knowledge.defineTerm({ term: "Handbook", meaning: `${sentence.repeat(35)}\n\n${sentence.repeat(30)}\n\nRelease: we ship on Fridays.` });

    const ranked = await knowledge.rank("when do we deploy", { limit: 1 });

    assert.equal(ranked.hits[0]!.note.id, long.id);
    assert.ok(ranked.hits[0]!.score! > 0, "the release line was embedded");
  });

  test(`14.15 [${backend.label}] the question is embedded after the model's query prefix, and an artifact's chunks without it`, async () => {
    const embedder = fakeEmbedder();
    const prefix = "Represent this sentence for searching relevant passages: ";
    const opened = await backend.open(async () => ({ ...embedder, queryPrefix: prefix }));
    try {
      await opened.knowledge.defineTerm({ term: "Mailer", meaning: "The mailer needs a verified sender." });

      await opened.knowledge.rank("how do I send an email");

      assert.deepEqual(embedder.embedded.filter((text) => text.startsWith(prefix)), [`${prefix}how do I send an email`]);
      assert.ok(embedder.embedded.some((text) => text.includes("verified sender")), "the artifact was embedded, with no prefix");
    } finally {
      await opened.cleanup();
    }
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

  test(`14.19 [${backend.label}] with no embedding model, rankAll's word matches include an arc by its intent or end state and an increment by its objective and body, a closed increment after an open one`, async () => {
    const opened = await backend.open(async () => {
      throw new Error("the embedding model is switched off");
    });
    try {
      await opened.records.create("story", { title: "Library", description: "Invoices and refunds." });
      const arc = await opened.records.create("arc", { title: "Outbox", intent: "Visitors pay by invoice.", endState: "Every receipt is archived." });
      const done = await opened.records.create("increment", {
        arc: arc.id, title: "Ledger", objective: "Refunds reach the customer.", body: "Chargebacks are disputed.", status: "closed", outcome: { date: "2026-11-19", pr: "#1", disposition: "landed" },
      });
      const open = await opened.records.create("increment", { arc: arc.id, title: "Ledger again", objective: "Refunds reach the bank.", body: "Chargebacks are disputed twice.", status: "active" });
      const ids = async (query: string): Promise<string[]> => {
        const ranked = await opened.knowledge.rankAll(query);
        assert.equal(ranked.by, "words");
        return ranked.hits.map(({ note }) => note.id);
      };

      assert.deepEqual(await ids("pay invoice"), [arc.id]);
      assert.deepEqual(await ids("receipt archived"), [arc.id]);
      assert.deepEqual(await ids("refunds chargebacks"), [open.id, done.id], "the closed increment was made first, and still comes after");
    } finally {
      await opened.cleanup();
    }
  });
}
