/** Capability 2 · Settings: every home here is thrown away after its test. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import * as agentLink from "../index.js";
import { withTempDir } from "../testing/folders.js";

test("2.1 without a settings file, context guidance reads as 600,000 tokens with its type and meaning", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, "home");
    assert.equal(typeof agentLink.readSettings, "function", "settings need a public reader");
    const reading = agentLink.readSettings(home)["context-guidance"];
    assert.equal(reading.name, "context-guidance");
    assert.equal(reading.value, 600_000);
    assert.equal(reading.default, 600_000);
    assert.equal(reading.source, "default");
    assert.equal(reading.type, "positive whole number");
    assert.equal(reading.unit, "tokens");
    assert.match(reading.meaning, /soft/i);
    assert.match(reading.meaning, /context/i);
    assert.equal(existsSync(home), false, "reading a default does not create a home or file");
  });
});

test("2.4 invalid settings are reported on read and set, and their bytes are preserved", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    for (const content of [
      '{"context-guidance":null}', "{broken", "", "null", "[]", "1", '"settings"',
      '{"context-guidance":"400000"}', '{"context-guidance":0}', '{"context-guidance":-1}',
      '{"context-guidance":1.5}', '{"context-guidance":9007199254740992}', '{"unknown":1}',
    ]) {
      writeFileSync(file, content);
      const reported = (error: unknown): boolean => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /invalid settings file/i);
        assert.ok(error.message.includes(file), error.message);
        return true;
      };
      assert.throws(() => agentLink.readSettings(home), reported, content);
      assert.throws(() => agentLink.setSetting("context-guidance", "400000", home), reported, content);
      assert.equal(readFileSync(file, "utf8"), content);
      assert.deepEqual(readdirSync(home), ["settings.json"], "no temporary files left behind");
    }
    writeFileSync(file, "{}");
    assert.equal(agentLink.readSettings(home)["context-guidance"].source, "default");
    assert.equal(agentLink.readSettings(home)["context-guidance"].value, 600_000);
    agentLink.setSetting("context-guidance", "600000", home);
    assert.equal(agentLink.readSettings(home)["context-guidance"].source, "set");
  });
});

test("2.4 an unreadable settings path is reported and a set does not replace it", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    // A directory fails as a file on all supported platforms, including Windows and root-run tests.
    mkdirSync(file);
    writeFileSync(path.join(file, "kept"), "untouched");
    for (const operation of [() => agentLink.readSettings(home), () => agentLink.setSetting("context-guidance", "400000", home)]) {
      assert.throws(operation, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /cannot read settings file/i);
        assert.ok(error.message.includes(file), error.message);
        return true;
      });
      assert.equal(readFileSync(path.join(file, "kept"), "utf8"), "untouched");
      assert.deepEqual(readdirSync(home), ["settings.json"]);
    }
  });
});

test("2.3 unknown names and values that are not positive whole numbers are refused without changing the file", async () => {
  await withTempDir((home) => {
    agentLink.setSetting("context-guidance", "400000", home);
    const file = path.join(home, "settings.json");
    const before = readFileSync(file, "utf8");
    for (const name of ["unknown", "toString", "__proto__"]) {
      assert.throws(() => agentLink.setSetting(name, "1", home), /unknown setting/i);
      assert.equal(readFileSync(file, "utf8"), before);
    }
    for (const value of ["0", "-1", "1.5", "", " ", "many", "NaN", "Infinity", "1e3", "0x10", "9007199254740992"]) {
      assert.throws(() => agentLink.setSetting("context-guidance", value, home), /context-guidance.*positive whole number/i, value);
      assert.equal(readFileSync(file, "utf8"), before, value);
    }
    const absentHome = path.join(home, "absent");
    assert.throws(() => agentLink.setSetting("context-guidance", "0", absentHome), /positive whole number/i);
    assert.equal(existsSync(absentHome), false);
  });
});

const INSTANCE = "my-project:australia-southeast1:my-instance";

test("2.10 idle-after defaults to 30 minutes and accepts positive durations without losing other settings", async () => {
  await withTempDir((home) => {
    const initial = agentLink.readSettings(home)["idle-after"];
    assert.equal(initial.value, "30m");
    assert.equal(initial.default, "30m");
    assert.equal(initial.type, "duration");
    assert.equal(initial.source, "default");
    agentLink.setSetting("context-guidance", "400000", home);
    for (const value of ["10m", "45s", "2h", "1d"]) {
      assert.equal(agentLink.setSetting("idle-after", value, home).value, value);
      assert.equal(agentLink.readSettings(home)["idle-after"].source, "set");
      assert.equal(agentLink.readSettings(home)["context-guidance"].value, 400_000);
    }
    agentLink.setLibrary(["local"], home);
    assert.equal(agentLink.readSettings(home)["idle-after"].value, "1d");
  });
});

test("2.11 leave-after defaults to 1 hour and accepts positive durations; one that is not a duration is refused and the file is left byte for byte (ADR-0754 D4, ADR-0758 D5)", async () => {
  await withTempDir((home) => {
    const initial = agentLink.readSettings(home)["leave-after"];
    assert.deepEqual({ value: initial.value, default: initial.default, type: initial.type, source: initial.source }, { value: "1h", default: "1h", type: "duration", source: "default" });
    assert.equal(agentLink.setSetting("leave-after", "2h", home).value, "2h");
    assert.equal(agentLink.readSettings(home)["leave-after"].source, "set");
    assert.equal(agentLink.leaveAfterMs(home), 2 * 3_600_000);
    const before = readFileSync(path.join(home, "settings.json"), "utf8");
    assert.throws(() => agentLink.setSetting("leave-after", "soon", home), /leave-after.*positive duration/i);
    assert.equal(readFileSync(path.join(home, "settings.json"), "utf8"), before);
  });
});

test("2.10 invalid idle durations are refused with a reason and leave the file byte for byte", async () => {
  await withTempDir((home) => {
    agentLink.setSetting("context-guidance", "400000", home);
    const file = path.join(home, "settings.json");
    const before = readFileSync(file, "utf8");
    for (const value of ["soon", "0m", "-5m", "10", "", "1.5m", "Infinityh", "9007199254740991d"]) {
      assert.throws(() => agentLink.setSetting("idle-after", value, home), /idle-after.*positive duration/i, value);
      assert.equal(readFileSync(file, "utf8"), before);
    }
    for (const value of [null, 600_000, "soon", "0m", "-5m"]) {
      const invalid = JSON.stringify({ "idle-after": value });
      writeFileSync(file, invalid);
      assert.throws(() => agentLink.readSettings(home), /Invalid settings file.*idle-after.*positive duration/);
      assert.throws(() => agentLink.setSetting("context-guidance", "500000", home), /Invalid settings file/);
      assert.equal(readFileSync(file, "utf8"), invalid);
    }
  });
});

test("2.5 the library is local by default, set to a Cloud SQL instance, and set back to local", async () => {
  await withTempDir((home) => {
    const initial = agentLink.readSettings(home).library;
    assert.equal(initial.location, "local");
    assert.equal(initial.default, "local");
    assert.equal(initial.source, "default");
    assert.match(initial.meaning, /where/i);
    agentLink.setSetting("context-guidance", "400000", home);
    assert.deepEqual(agentLink.setLibrary(["cloudsql", INSTANCE, "you@example.com"], home),
      { ...initial, location: "cloudsql", instance: INSTANCE, user: "you@example.com", source: "set" });
    assert.deepEqual(agentLink.readSettings(home).library,
      { ...initial, location: "cloudsql", instance: INSTANCE, user: "you@example.com", source: "set" });
    assert.equal(agentLink.readSettings(home)["context-guidance"].value, 400_000, "the other setting is kept");
    assert.deepEqual(JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8")).library,
      { location: "cloudsql", instance: INSTANCE, user: "you@example.com" });
    assert.deepEqual(agentLink.setLibrary(["local"], home), { ...initial, source: "set" });
  });
});

test("2.6 a library setting that is not local or a well-written Cloud SQL instance and account is refused, the file untouched", async () => {
  await withTempDir((home) => {
    agentLink.setLibrary(["local"], home);
    const file = path.join(home, "settings.json");
    const before = readFileSync(file, "utf8");
    for (const words of [[], ["remote"], ["local", "extra"], ["cloudsql"], ["cloudsql", INSTANCE], ["cloudsql", "my-instance", "you@example.com"],
      ["cloudsql", INSTANCE, "not an email"], ["cloudsql", INSTANCE, "you@example.com", "extra"]]) {
      assert.throws(() => agentLink.setLibrary(words, home), /library/i, JSON.stringify(words));
      assert.equal(readFileSync(file, "utf8"), before, JSON.stringify(words));
    }
    writeFileSync(file, JSON.stringify({ library: { location: "cloudsql", instance: "bad" } }));
    assert.throws(() => agentLink.readSettings(home), /invalid settings file/i);
  });
});

test("2.12 the library is set to a Postgres address without its password, and an address carrying one is refused, the file untouched (ADR-0846 D1)", async () => {
  await withTempDir((home) => {
    const address = "postgres://me@db.example.com:5432/postgres?sslmode=require";
    const initial = agentLink.readSettings(home).library;
    assert.deepEqual(agentLink.setLibrary(["postgres", address], home), { ...initial, location: "postgres", address, source: "set" });
    assert.deepEqual(agentLink.readSettings(home).library, { ...initial, location: "postgres", address, source: "set" });
    const file = path.join(home, "settings.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).library, { location: "postgres", address });

    const before = readFileSync(file, "utf8");
    assert.throws(() => agentLink.setLibrary(["postgres", "postgres://me:hunter2@db.example.com/postgres"], home), (error: Error) => {
      assert.match(error.message, /storytree auth set postgres/);
      assert.ok(!error.message.includes("hunter2"), error.message);
      return true;
    });
    for (const words of [["postgres"], ["postgres", "db.example.com"], ["postgres", "https://me@db.example.com/postgres"], ["postgres", "postgres://db.example.com/postgres"], ["postgres", address, "extra"]]) {
      assert.throws(() => agentLink.setLibrary(words, home), /library/i, JSON.stringify(words));
    }
    assert.equal(readFileSync(file, "utf8"), before);
  });
});

test("2.12 the library is set to a wss:// address without its password, and one carrying a password is refused, the file untouched", async () => {
  await withTempDir((home) => {
    const address = "wss://me@library.example.com/postgres";
    const initial = agentLink.readSettings(home).library;
    assert.deepEqual(agentLink.setLibrary(["postgres", address], home), { ...initial, location: "postgres", address, source: "set" });
    const file = path.join(home, "settings.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).library, { location: "postgres", address });

    const before = readFileSync(file, "utf8");
    assert.throws(() => agentLink.setLibrary(["postgres", "wss://me:hunter2@library.example.com/postgres"], home), (error: Error) => {
      assert.match(error.message, /storytree auth set postgres/);
      assert.ok(!error.message.includes("hunter2"), error.message);
      return true;
    });
    for (const words of [["postgres", "wss://library.example.com/postgres"], ["postgres", "ws://me@library.example.com/postgres"]]) {
      assert.throws(() => agentLink.setLibrary(words, home), /wss:\/\//, JSON.stringify(words));
    }
    assert.equal(readFileSync(file, "utf8"), before);
  });
});

test("the settings file keeps the app's surface choices beside the settings, and refuses them in the wrong shape (ADR-0750)", async () => {
  await withTempDir((home) => {
    assert.deepEqual(agentLink.readSurfaceChoices(home), {});
    agentLink.setSetting("idle-after", "10m", home);
    agentLink.setSurfaceChoice("sessions", "on", false, home);
    agentLink.setSurfaceChoice("globe", "opening-zoom", "close", home);
    assert.deepEqual(agentLink.readSurfaceChoices(home), { sessions: { on: false }, globe: { "opening-zoom": "close" } });
    assert.equal(agentLink.readSettings(home)["idle-after"].value, "10m", "the other settings still read");
    const file = path.join(home, "settings.json");
    const bad = JSON.stringify({ surfaces: { sessions: { on: "no" } } });
    writeFileSync(file, bad);
    assert.throws(() => agentLink.readSurfaceChoices(home), /Invalid settings file.*surfaces/);
    assert.throws(() => agentLink.setSurfaceChoice("sessions", "on", true, home), /Invalid settings file/);
    assert.equal(readFileSync(file, "utf8"), bad);
  });
});

test("2.2 setting context guidance to 400000 writes it to settings.json in the storytree home, and a fresh read gives 400,000 marked as set", async () => {
  await withTempDir((home) => {
    agentLink.setSetting("context-guidance", "400000", home);
    assert.deepEqual(JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8")), { "context-guidance": 400_000 });
    const reading = agentLink.readSettings(home)["context-guidance"];
    assert.equal(reading.value, 400_000);
    assert.equal(reading.source, "set");
  });
});

test("2.15 settings.json may name the experiment and arm a lane runs in, and the verbs that arm denies, read back by name; with none it reads as none, and a damaged value is reported naming the file", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    assert.equal(agentLink.readExperiment(home), undefined, "no settings file: no experiment");
    writeFileSync(file, JSON.stringify({ "idle-after": "10m" }));
    assert.equal(agentLink.readExperiment(home), undefined, "a file naming none: no experiment");

    writeFileSync(file, JSON.stringify({ "idle-after": "10m", experiment: { name: "twin-build", arm: "map-reads-off" } }));
    assert.deepEqual(agentLink.readExperiment(home), { name: "twin-build", arm: "map-reads-off" });
    assert.equal(agentLink.readSettings(home)["idle-after"].value, "10m", "the other settings still read beside it");
    const denies = { tools: ["focus"], commands: ["storytree map"] };
    writeFileSync(file, JSON.stringify({ experiment: { name: "twin-build", arm: "map-reads-off", denies } }));
    assert.deepEqual(agentLink.readExperiment(home), { name: "twin-build", arm: "map-reads-off", denies }, "the arm's denies, by door, read back beside it");

    for (const damaged of [{ name: "twin-build" }, { arm: "map-reads-off" }, { name: "", arm: "x" }, { name: "a", arm: "b", extra: 1 }, "twin-build", null,
      { name: "a", arm: "b", denies: { tools: ["focus"] } }, { name: "a", arm: "b", denies: { tools: [""], commands: [] } }, { name: "a", arm: "b", denies: { tools: [], commands: [], more: [] } }]) {
      writeFileSync(file, JSON.stringify({ experiment: damaged }));
      assert.throws(() => agentLink.readExperiment(home), (error: unknown) => {
        assert.ok(error instanceof Error && error.message.includes(file) && /experiment/.test(error.message), String(error));
        return true;
      }, JSON.stringify(damaged));
    }
  });
});

test("2.16 settings.json may name the story parts switched off on this computer: switched off and on by name, read back sorted, the other settings untouched; the core is refused with the reason, and a damaged value is reported naming the file", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    assert.deepEqual(agentLink.readPartsOff(home), [], "no settings file: nothing off");
    agentLink.setSetting("idle-after", "10m", home);
    assert.deepEqual(agentLink.setPartOff("forest", true, home), ["forest"]);
    assert.deepEqual(agentLink.setPartOff("arc-surface", true, home), ["arc-surface", "forest"]);
    assert.deepEqual(agentLink.setPartOff("forest", true, home), ["arc-surface", "forest"], "switching an off part off again changes nothing");
    assert.deepEqual(agentLink.readPartsOff(home), ["arc-surface", "forest"]);
    assert.equal(agentLink.readSettings(home)["idle-after"].value, "10m", "the other settings still read beside it");
    assert.deepEqual(agentLink.setPartOff("forest", false, home), ["arc-surface"]);

    for (const core of ["library", "plugin-loader", "project-and-caller"]) {
      assert.throws(() => agentLink.setPartOff(core, true, home), new RegExp(`${core} is the core`));
    }
    assert.deepEqual(agentLink.readPartsOff(home), ["arc-surface"], "a refused switch writes nothing");

    for (const damaged of ["forest", [""], [1], null]) {
      writeFileSync(file, JSON.stringify({ "parts-off": damaged }));
      for (const read of [() => agentLink.readPartsOff(home), () => agentLink.readSettings(home)]) {
        assert.throws(read, (error: unknown) => {
          assert.ok(error instanceof Error && error.message.includes(file) && /parts-off/.test(error.message), String(error));
          return true;
        }, JSON.stringify(damaged));
      }
    }
  });
});

test("2.19 · a machine's health limits read as 6 GB of memory available, a load of 12 and a disk 85% full by default; each is set as a positive whole number, the disk's at most 100, and any other value is refused with the file left byte for byte", async () => {
  await withTempDir((home) => {
    const read = () => agentLink.readSettings(home);
    assert.deepEqual(
      [read()["health-memory"], read()["health-load"], read()["health-disk"]].map(({ value, unit, group, source }) => ({ value, unit, group, source })),
      [{ value: 6, unit: "GB", group: "machine", source: "default" }, { value: 12, unit: "", group: "machine", source: "default" }, { value: 85, unit: "%", group: "machine", source: "default" }],
    );
    assert.equal(agentLink.setSetting("health-memory", "8", home).value, 8);
    assert.equal(agentLink.setSetting("health-load", "20", home).value, 20);
    assert.equal(agentLink.setSetting("health-disk", "90", home).value, 90);
    assert.deepEqual([read()["health-memory"].source, read()["health-load"].value, read()["health-disk"].value], ["set", 20, 90]);
    const before = readFileSync(path.join(home, "settings.json"), "utf8");
    for (const [name, value] of [["health-memory", "0"], ["health-load", "1.5"], ["health-disk", "101"], ["health-disk", "many"]] as const) {
      assert.throws(() => agentLink.setSetting(name, value, home), new RegExp(name), `${name} ${value}`);
      assert.equal(readFileSync(path.join(home, "settings.json"), "utf8"), before, `${name} ${value}`);
    }
    writeFileSync(path.join(home, "settings.json"), JSON.stringify({ "health-disk": 120 }));
    assert.throws(() => read(), /health-disk/);
  });
});

test("2.24 · a checked-in worktree setup's approval is kept in settings.json per repository, as its commands' fingerprint and when it was given, a later approval replacing the earlier one, and a damaged record is refused naming the file", async () => {
  await withTempDir((home) => {
    assert.equal(agentLink.readSetupApproval("/work/site", home), undefined, "none is given until the user gives one");
    agentLink.setSetupApproval("/work/site", "0123456789abcdef", home, new Date("2026-10-25T09:00:00.000Z"));
    agentLink.setSetupApproval("/work/other", "fedcba9876543210", home, new Date("2026-10-25T09:30:00.000Z"));
    agentLink.setSetupApproval("/work/site", "1111222233334444", home, new Date("2026-10-25T10:00:00.000Z"));
    assert.deepEqual(agentLink.readSetupApproval("/work/site", home), { fingerprint: "1111222233334444", at: "2026-10-25T10:00:00.000Z" });
    assert.deepEqual(agentLink.readSetupApproval("/work/other", home), { fingerprint: "fedcba9876543210", at: "2026-10-25T09:30:00.000Z" });
    assert.equal(agentLink.readSettings(home)["context-guidance"].source, "default", "the other settings read as before");

    const file = path.join(home, "settings.json");
    writeFileSync(file, JSON.stringify({ "setup-approvals": { "/work/site": { fingerprint: 7 } } }));
    assert.throws(() => agentLink.readSetupApproval("/work/site", home), (error: unknown) => error instanceof Error && error.message.includes(file) && /setup-approvals/.test(error.message));
    assert.throws(() => agentLink.setSetupApproval("/work/site", "1111222233334444", home), /setup-approvals/);
    assert.equal(readFileSync(file, "utf8"), JSON.stringify({ "setup-approvals": { "/work/site": { fingerprint: 7 } } }), "a damaged file is never replaced");
  });
});
