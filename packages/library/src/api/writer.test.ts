/** Capability 2.10 / 7.6: the writer survives every library write, on both stores and through the public API. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";
import { HealthRecord } from "../health/index.js";
import { Knowledge } from "../knowledge/index.js";
import { connect as connectProject } from "../project/index.js";
import { SchemaRecords } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions } from "../transactions/index.js";
import { WorkInFlight, WorkModel } from "../work/index.js";

// The same journey runs on the domain layers over memory and Postgres, then on the public handle.
// History is read through the already-existing records layer until public reads land separately.
for (const backend of ["memory", "postgres", "public postgres"] as const) {
  test(`2.10 / 7.6 [${backend}] every write keeps its optional writer in history`, async () => {
    const name = uniqueProjectName();
    const server = backend === "memory" ? undefined : await connectProject({ url: testServerUrl() });
    const api = backend === "public postgres" ? await connect({ url: testServerUrl() }) : undefined;
    try {
      const project = await server?.openProject(name);
      const records = project?.records ?? new SchemaRecords(new MemoryTransactions());
      const lib = await api?.openProject(name);
      const work: Pick<Library, "addStory" | "editStory" | "createArc" | "editArc" | "addCapability" | "editCapability" | "addContract" | "editContract"> = lib ?? project?.work ?? new WorkModel(records);
      const flight: Pick<Library, "addIncrement" | "advanceIncrement" | "closeIncrement" | "editIncrement" | "parkArc" | "unparkArc" | "addWait" | "removeWait" | "raiseQuestion" | "settleQuestion" | "retire"> = lib ?? project?.flight ?? new WorkInFlight(records);
      const knowledge: Pick<Library, "writeMemory" | "recordDecision" | "defineTerm" | "writeKnowledge" | "editNote" | "composeStatement"> = lib ?? project?.knowledge ?? new Knowledge(records);
      const health = lib ?? project?.health ?? new HealthRecord(records, new WorkModel(records));

      for (const actor of ["person:Sam", "session:agent-42", undefined]) {
        const options = actor === undefined ? {} : { actor };
        const before = (await records.history()).at(-1)?.seq ?? 0;
        const story = await work.addStory({ title: "Sign up" }, options);
        await work.editStory(story.id, { description: "Visitors join." }, options);
        const arc = await work.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors join" }, options);
        await work.editArc(arc.id, { stories: [story.id] }, options);
        const capability = await work.addCapability({ title: "Email form", story: story.id }, options);
        await work.editCapability(capability.id, { description: "Enter an email." }, options);
        const contract = await work.addContract({ title: "Reject a bad email", capability: capability.id }, options);
        await work.editContract(contract.id, { title: "Reject an email without @" }, options);
        const increment = await flight.addIncrement({ arc: arc.id, title: "Form", objective: "Build it", body: "Form and checks" }, options);
        await flight.editIncrement(increment.id, { touches: [capability.id] }, options);
        await flight.advanceIncrement(increment.id, "active", options);
        await flight.closeIncrement(increment.id, { disposition: "landed", pr: "#12" }, options);
        await flight.parkArc(arc.id, options);
        await flight.unparkArc(arc.id, options);
        const blocker = await work.createArc({ title: "Mailer", intent: "Send emails", endState: "Emails arrive" }, options);
        await flight.addWait(arc.id, blocker.id, "Needs mail", options);
        await flight.removeWait(arc.id, blocker.id, options);
        const question = await flight.raiseQuestion({ arc: arc.id, title: "Mailer?", stakes: "Delivery", statement: "Which mailer?", context: "Sign-up", options: "Mailgun" }, options);
        await flight.settleQuestion(question.id, { answer: "Mailgun" }, options);
        const decision = await knowledge.recordDecision({ title: "Mailgun", text: "Simple API", status: "accepted" }, options);
        await knowledge.composeStatement(decision.id, "We send via Mailgun.", options);
        const note = await knowledge.writeMemory({ text: "Verify the domain" }, options);
        await knowledge.editNote(note.id, { text: "Verify the sending domain" }, options);
        await knowledge.defineTerm({ term: "Sender", meaning: "The sending domain" }, options);
        await knowledge.writeKnowledge("principle", { title: "Keep it simple", statement: "Use one mailer", why: "Less setup", howToApply: "Reuse it" }, options);
        await health.reportHealth(contract.id, "failing", options);
        await health.reportHealth(contract.id, "passing", options); // another save of the same health record
        await health.recordVerified(contract.id, "passing", options);
        await flight.retire(note.id, "Folded into the decision", options);

        const entries = await records.history({ since: before });
        assert.equal(entries.length, 29, "one history entry for each write");
        for (const entry of entries) {
          assert.equal(entry.actor, actor, `${entry.type} ${entry.action} by ${actor}`);
          assert.equal(Object.hasOwn(entry, "actor"), actor !== undefined, "an omitted writer stays absent");
          assert.equal(Object.hasOwn(entry.record.fields, "actor"), false, "the writer is metadata, not a record field");
        }
        assert.equal(entries.at(-1)?.reason, "Folded into the decision");

        // Refused writes and harmless no-ops cannot invent an attributed history entry.
        await assert.rejects(work.editStory(story.id, { title: "" }, options));
        assert.equal(await work.editStory("missing", { title: "Missing" }, options), null);
        await flight.retire(note.id, "Already retired", options);
        assert.deepEqual(await records.history({ since: before }), entries);

        // Health's reporter can differ from the person/session recording it.
        await health.reportHealth(contract.id, "passing", { by: "test-runner", actor: "session:scribe" });
        const report = (await records.history()).at(-1)!;
        assert.equal(report.actor, "session:scribe");
        assert.equal(report.record.fields.by, "test-runner");
      }
    } finally {
      await api?.close();
      await server?.close();
      if (server !== undefined) await dropTestDatabases([`storytree_${name}`]);
    }
  });
}
