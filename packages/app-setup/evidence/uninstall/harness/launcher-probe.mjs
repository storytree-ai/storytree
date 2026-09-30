// Narrows down why openUninstaller's delayed PowerShell launch does nothing. Each variant logs its output.
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const enc = (s) => Buffer.from(s, "utf16le").toString("base64");
const variants = {
  E_writeOnly: "Set-Content -LiteralPath $env:OUTF -Value ran",
  F_sleepThenWrite: "Start-Sleep -Seconds 2; Set-Content -LiteralPath $env:OUTF -Value ran",
  G_startProcess: "Start-Process -FilePath $env:ComSpec -ArgumentList ('/c echo ran > \"' + $env:OUTF + '\"') -Wait; 'after start-process'",
  H_envSeen: "'uninstaller=' + $env:STORYTREE_UNINSTALLER + ' args=' + $env:STORYTREE_UNINSTALL_ARGS",
};
for (const [name, script] of Object.entries(variants)) {
  const log = openSync(path.join(dir, `log-${name}.txt`), "w");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", enc(script)], {
    detached: true, stdio: ["ignore", log, log], windowsHide: true,
    env: { ...process.env, OUTF: path.join(dir, `ran-${name}.txt`), STORYTREE_UNINSTALLER: "C:\\x y\\u.exe", STORYTREE_UNINSTALL_ARGS: "/S --keep-library" },
  });
  child.once("error", (e) => console.log(name, "error", e.message));
  child.once("spawn", () => { console.log(name, "spawned", child.pid); child.unref(); });
}
