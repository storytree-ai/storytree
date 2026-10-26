// A stand-in for `systemd-run --user` and `systemctl --user`, for the voice committer's tests only (contract 5.13).
//
//   fake-systemd.mjs <state dir> run [--user] [--unit=NAME] [--collect] [--quiet] [--working-directory=DIR] [--setenv=NAME]… <command…>
//     writes its argv to <state>/<NAME>.argv as JSON, starts the command detached in DIR with only the --setenv names, as a
//     transient unit gets only what it is given, writes its pid to <state>/<NAME>.pid and exits. With <state>/refuse present
//     it starts nothing and exits 1, as systemd-run does when the unit cannot start.
//   fake-systemd.mjs <state dir> ctl [--user] is-active <NAME>.service
//     prints "active" while that pid runs, else "inactive" (exit 3). With <state>/broken present it cannot reach the bus.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [state, mode, ...rest] = process.argv.slice(2);

if (mode === "run") {
  if (existsSync(path.join(state, "refuse"))) {
    process.stderr.write("Failed to start transient service unit: Unit voice-run already exists.\n");
    process.exit(1);
  }
  let unit = "run-fake";
  let cwd = process.cwd();
  const env = {};
  let at = 0;
  for (; at < rest.length && rest[at].startsWith("--"); at++) {
    const [flag, value] = rest[at].split(/=(.*)/s);
    if (flag === "--unit") unit = value;
    else if (flag === "--working-directory") cwd = value;
    else if (flag === "--setenv" && process.env[value] !== undefined) env[value] = process.env[value];
  }
  writeFileSync(path.join(state, `${unit}.argv`), JSON.stringify(rest));
  const [command, ...args] = rest.slice(at);
  const child = spawn(command, args, { cwd, env, detached: true, stdio: "ignore" });
  child.on("spawn", () => {
    writeFileSync(path.join(state, `${unit}.pid`), String(child.pid));
    child.unref();
    process.exit(0);
  });
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
} else if (mode === "ctl") {
  if (existsSync(path.join(state, "broken"))) {
    process.stderr.write("Failed to connect to bus: No medium found\n");
    process.exit(1);
  }
  const unit = rest[rest.length - 1].replace(/\.service$/, "");
  const pidFile = path.join(state, `${unit}.pid`);
  let running = false;
  if (existsSync(pidFile)) {
    try {
      process.kill(Number(readFileSync(pidFile, "utf8")), 0);
      running = true;
    } catch {
      running = false;
    }
  }
  process.stdout.write(running ? "active\n" : "inactive\n");
  process.exit(running ? 0 : 3);
} else {
  process.stderr.write(`fake-systemd: unknown mode ${mode}\n`);
  process.exit(2);
}
