import { createHash } from "node:crypto";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const INSTALL_COMMAND = "& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.ps1')))\r\n";

export const WINDOWS_ARCHITECTURES = ["x64", "arm64"];
export const windowsInstaller = (version, arch) => `storytree-0.3-${version}-windows-${arch}-setup.exe`;

export function deliveryAssets(dir, version) {
  const installers = Object.fromEntries(WINDOWS_ARCHITECTURES.map((arch) => {
    const name = windowsInstaller(version, arch);
    const bytes = readFileSync(path.join(dir, name));
    return [arch, { name, sha256: createHash("sha256").update(bytes).digest("hex"), sha512: createHash("sha512").update(bytes).digest("base64"), size: bytes.length }];
  }));
  writeFileSync(path.join(dir, "storytree-delivery.json"), JSON.stringify({ schema: 1, channelSchema: 1, version, architectures: WINDOWS_ARCHITECTURES, installers }, null, 2) + "\n");
  windowsBootstraps(dir);
}

export function windowsBootstraps(dir) {
  cpSync(path.join(here, "../../packages/app-setup/src/deliver/install.ps1"), path.join(dir, "install-storytree.ps1"));
  writeFileSync(path.join(dir, "install-storytree.txt"), INSTALL_COMMAND);
  writeFileSync(path.join(dir, "install-storytree-alpha.txt"), "& ([scriptblock]::Create((Invoke-RestMethod 'https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.ps1'))) -Channel alpha\r\n");
}

export const MAC_INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.sh | sh\n";
const MAC_ALPHA_COMMAND = "curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.sh | sh -s -- --channel alpha\n";

export function macDeliveryAssets(dir, version) {
  const name = `storytree-0.3-${version}-mac-arm64.zip`;
  const bytes = readFileSync(path.join(dir, name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(path.join(dir, "storytree-delivery-mac.json"), JSON.stringify({ version, macos: { arm64: { name, sha256, size: bytes.length } } }, null, 2) + "\n");
  macBootstraps(dir);
}

export function macBootstraps(dir) {
  cpSync(path.join(here, "../../packages/app-setup/src/deliver/install.sh"), path.join(dir, "install-storytree.sh"));
  writeFileSync(path.join(dir, "install-storytree-mac.txt"), MAC_INSTALL_COMMAND);
  writeFileSync(path.join(dir, "install-storytree-mac-alpha.txt"), MAC_ALPHA_COMMAND);
}

export function linuxDeliveryAssets(dir, version) {
  const name = `storytree-0.3-${version}-linux-x86_64.AppImage`;
  const bytes = readFileSync(path.join(dir, name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(path.join(dir, "storytree-delivery-linux.json"), JSON.stringify({ version, linux: { x64: { name, sha256, size: bytes.length } } }, null, 2) + "\n");
}
