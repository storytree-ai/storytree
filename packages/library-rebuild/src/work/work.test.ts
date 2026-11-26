import assert from "node:assert/strict";
import { test } from "node:test";

import { withCountedProject } from "../testing/pg.js";
import { WorkInFlight, WorkModel } from "./index.js";

test("32.1 · through the work entry, an increment listing a planned capability, held on a question on its arc, waits on the owner; settling the question releases it, holds name no hold on it, and the plan's tree still carries the capability", async () => {
  await withCountedProject(async (project) => {
    const work = new WorkModel(project.records);
    const flight = new WorkInFlight(project.records, work);
    const story = await work.addStory({ title: "Visitor can sign up" });
    const capability = await work.addCapability({ title: "Email form", story: story.id });
    const arc = await flight.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors can sign up" });
    const question = await flight.raiseQuestion({
      arc: arc.id,
      title: "Which mailer?",
      stakes: "Sign-up cannot send its confirmation until this is chosen",
      statement: "Which mail service sends the confirmation?",
      context: "Two are in reach; neither is set up",
      options: "Mailgun or SES",
    });
    const held = await flight.addIncrement({ arc: arc.id, title: "Confirmation email", objective: "Send it", body: "The steps.", capabilities: [capability.id], heldOn: [question.id] });

    assert.deepEqual(held.fields.capabilities, [capability.id]);
    assert.deepEqual(await flight.heldOnQuestion(held.id), [question.id]);
    assert.deepEqual((await flight.holds()).heldOn[held.id], [question.id]);

    const settled = await flight.settleQuestion(question.id, { answer: "Mailgun" });

    assert.deepEqual(settled?.released, [{ id: held.id, title: "Confirmation email" }]);
    assert.deepEqual(await flight.heldOnQuestion(held.id), []);
    assert.deepEqual((await flight.holds()).heldOn[held.id], []);
    const tree = await work.projectTree();
    assert.deepEqual(tree.stories.find(({ id }) => id === story.id)?.capabilities.map(({ id }) => id), [capability.id]);
  });
});
