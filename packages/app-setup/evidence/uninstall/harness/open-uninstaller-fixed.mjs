// The fixed openUninstaller's launch (storytree setup uninstall --remove-library), run with the installation's
// own Node until a release carries the fix: start the uninstaller itself, detached, and return.
import { spawn } from "node:child_process";
import path from "node:path";
const uninstaller = path.join(process.env.LOCALAPPDATA, "Programs", "storytree-0.3", "Uninstall storytree-0.3.exe");
const child = spawn(uninstaller, ["/currentuser", "/S", "--remove-library"], { detached: true, stdio: "ignore" });
child.once("error", (error) => { console.log(`could not start: ${error.message}`); process.exitCode = 1; });
child.once("spawn", () => { child.unref(); console.log("storytree is uninstalling in the background (removing your library)."); });
