/**
 * Capability 1 · Front door. `storytree app …`: control the running storytree app from outside (ADR-0656 D0), so an agent
 * testing it, or a script needing its database, never force-kills it. Each verb is the app story's
 * own function (packages/app); the door keeps no rule of its own.
 *
 * - `quit` asks the running app to quit, as its tray's Quit does, and answers once its database
 *   has stopped. A stopped app is left stopped (Lifecycle 1.7).
 */
import { Refusal, type Answer } from "../answer.js";
import type { Family, Verb } from "../door.js";

const quit: Verb = {
  name: "quit",
  usage: "app quit",
  summary: "quit the running storytree app, as its tray's Quit does",
  async act(): Promise<Answer> {
    const { quitApp } = await import("@storytree/app");
    const result = await quitApp();
    switch (result.state) {
      case "quit":
        return { text: "storytree quit: its database has stopped." };
      case "not running":
        return { text: "storytree isn't running, so there is nothing to quit." };
      case "still running":
        throw new Refusal("storytree was asked to quit but is still running after a minute. Quit it from its tray icon.");
      case "no record":
        throw new Refusal(result.message);
    }
  },
};

export const appFamily: Family = {
  name: "app",
  summary: "control the running storytree app (the app story's)",
  verbs: [quit],
};
