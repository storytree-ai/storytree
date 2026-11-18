import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { openJourney } from "@storytree/app-setup/journey-events";
import { connect } from "@storytree/library";
import { findBinaries, start } from "@storytree/local-postgres";

const desktop = path.resolve("apps/desktop");
const home = mkdtempSync(path.join(tmpdir(), "storytree-app-"));
process.env.STORYTREE_HOME = home;
const { APP_OWNER, appHome } = await import("./src/home.ts");
const screenshot = path.resolve(process.env.STORYTREE_SMOKE_SCREENSHOT ?? path.join(home, "smoke.png"));
const STRESS_ROUNDS = "3";

let code = 1;
try {
  const journey = openJourney({ home: appHome().dir, appVersion: "0.3.0" });
  try { journey.choose(false); } finally { journey.close(); }
  const postgres = await start({ dataDir: appHome().pgdata, owner: APP_OWNER, bin: findBinaries({ resolveFrom: desktop }) });
  try {
    const storytree = await connect({ url: postgres.url });
    try {
      const project = await storytree.openProject("smoke");
      const story = await project.addStory({ title: "Smoke story" });
      await project.addCapability({ title: "Smoke capability", story: story.id });
    } finally {
      await storytree.close();
    }
  } finally {
    await postgres.stop();
  }

  const electron = createRequire(path.join(desktop, "package.json"))("electron");
  const software = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  const args = [desktop, "--smoke", "--stress", STRESS_ROUNDS, "--screenshot", screenshot, "--no-sandbox", ...software, ...process.argv.slice(2)];
  code = await new Promise((resolve, reject) => {
    const child = spawn(electron, args, { stdio: "inherit", env: { ...process.env, STORYTREE_HOME: home } });
    child.on("error", reject);
    child.on("exit", (exitCode, signal) => { if (signal !== null) console.error(`check-app-linux: the app was ended by ${signal}`); resolve(exitCode ?? 1); });
  });
  console.log(`check-app-linux: the app exited ${code}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
process.exit(code);
