/** Capability 2 · Settings, contract 2.25: a service of a part turned on and off for this machine (ADR-1180 D2). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { VerbRefusal } from "@storytree/library/verbs";

import { withTempDir } from "../testing/folders.js";
import { servicesSaid, switchService } from "./services.js";
import { readServicesOn } from "./settings.js";

test("2.25 `settings set service <part>/<service> on|off` turns a service on or off for this machine, saved in settings.json; every service is off until it is turned on, and a name not of the form <part>/<service> or a state but on or off is refused, saving nothing", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    assert.deepEqual(readServicesOn(home), [], "every service is off until it is turned on");

    assert.deepEqual(switchService("voice/listen", "on", home), ["voice/listen"]);
    assert.deepEqual(switchService("voice/commit", "on", home), ["voice/commit", "voice/listen"]);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "services-on": ["voice/commit", "voice/listen"] });
    assert.deepEqual(readServicesOn(home), ["voice/commit", "voice/listen"]);
    assert.match(servicesSaid(readServicesOn(home)), /^Turned on on this computer: voice\/commit, voice\/listen\./);

    assert.deepEqual(switchService("voice/listen", "off", home), ["voice/commit"]);
    assert.deepEqual(readServicesOn(home), ["voice/commit"]);
    assert.deepEqual(switchService("voice/commit", "off", home), []);
    assert.match(servicesSaid([]), /^No service is turned on on this computer\./);

    for (const [name, state, refusal] of [["listen", "on", /<part>\/<service>/], ["voice/listen/x", "on", /<part>\/<service>/], ["Voice/listen", "on", /<part>\/<service>/], ["voice/listen", "maybe", /on or off/]] as const) {
      assert.throws(() => switchService(name, state, home), (error: unknown) => error instanceof VerbRefusal && error.misuse === true && refusal.test(error.message));
    }
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "services-on": [] }, "a refused switch saves nothing");
  });
});
