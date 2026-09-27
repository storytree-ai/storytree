// The release's bootstrap and its checksum manifest ship in the same draft as the NSIS feed.
import { createHash } from "node:crypto";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function deliveryAssets(dir, version) {
  const installer = `storytree-0.3-${version}-setup.exe`;
  const sha256 = createHash("sha256").update(readFileSync(path.join(dir, installer))).digest("hex");
  const here = path.dirname(fileURLToPath(import.meta.url));
  cpSync(path.join(here, "../../packages/app-setup/src/deliver/install.ps1"), path.join(dir, "install-storytree.ps1"));
  writeFileSync(path.join(dir, "storytree-delivery.json"), JSON.stringify({ schema: 1, version, architectures: ["x64", "arm64"], installer: { name: installer, sha256 } }, null, 2) + "\n");
  writeFileSync(path.join(dir, "install-storytree.txt"), "& ([scriptblock]::Create((Invoke-RestMethod 'https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.ps1')))\r\n");
}
