// Capability 1 · Lifecycle
import { verb, VerbRefusal, type VerbFamily, type VerbPlace } from "@storytree/library/verbs";

const quit = verb({
  consumers: ["user"],
  command: { family: "app", name: "quit", summary: "quit the running storytree app, as its tray's Quit does" },
  tool: { absent: "an agent quits the app from its shell, where the app's own record of where it runs is" },
  inputs: {},
  callerless: true,
  async act() {
    const { quitApp } = await import("./quit.js");
    const result = await quitApp();
    switch (result.state) {
      case "quit":
        return { text: "storytree quit: its database has stopped." };
      case "not running":
        return { text: "storytree isn't running, so there is nothing to quit." };
      case "still running":
        throw new VerbRefusal("storytree was asked to quit but is still running after a minute. Quit it from its tray icon.");
      case "no record":
        throw new VerbRefusal(result.message);
    }
  },
});

export const APP_FAMILIES: readonly VerbFamily<VerbPlace>[] = [
  { name: "app", summary: "control the running storytree app (the app story's)", order: 11, verbs: [quit] },
];
