// The real app, run in CI (lifecycle 1.29, the owner's option A on question_c34fd1a7f98b): seed a throwaway home's
// library with one project, one story and one capability, then start the built app on it with `--smoke --stress`, and
// exit with the app's own exit code. That code is red when the page did not draw the project, and when the main process
// logged any error, one raised while it quits included. Run with tsx from the checkout's root after
// `pnpm --filter @storytree/desktop build`, under a display (CI: `xvfb-run -a`); any further arguments go to the app
// (`--ozone-platform=headless` where there is none). No real app data is used.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { connect } from "@storytree/library";
import { findBinaries, start } from "@storytree/local-postgres";

const desktop = path.resolve("apps/desktop");
const home = mkdtempSync(path.join(tmpdir(), "storytree-app-"));
process.env.STORYTREE_HOME = home;
const { APP_OWNER, appHome } = await import("./src/home.ts");
// Where the smoke screenshot goes, kept for CI to upload when the run fails; by default inside the throwaway home.
const screenshot = path.resolve(process.env.STORYTREE_SMOKE_SCREENSHOT ?? path.join(home, "smoke.png"));
const STRESS_ROUNDS = "3";

let code = 1;
try {
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
    // The app starts its own Postgres on this data directory, which a running one would hold.
    await postgres.stop();
  }

  const electron = createRequire(path.join(desktop, "package.json"))("electron");
  // A runner has no GPU: Chromium draws with SwiftShader, as the settings panel's Electron capture does, or capturing the
  // page fails (UnknownVizError).
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
