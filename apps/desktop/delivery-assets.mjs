// The release's bootstraps and its checksum manifest ship in the same draft as each platform's feed.
// Windows writes storytree-delivery.json beside the NSIS installer; the Mac runner, which alone has the
// zip, writes its entry as storytree-delivery-mac.json, and the Linux runner its AppImage's as storytree-delivery-linux.json;
// both are merged into the manifest when the release publishes. The Mac's install-storytree.sh serves Linux too.
// A release without a platform's new build still carries that platform's bootstraps, written on publish from its own
// checkout (windowsBootstraps, macBootstraps), so a one-liner is always the release's own.
import { createHash } from "node:crypto";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The stable one-liner, as install-storytree.txt carries it; the release notes quote it too. */
export const INSTALL_COMMAND = "& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.ps1')))\r\n";

export function deliveryAssets(dir, version) {
  const installer = `storytree-0.3-${version}-setup.exe`;
  const bytes = readFileSync(path.join(dir, installer));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  writeFileSync(path.join(dir, "storytree-delivery.json"), JSON.stringify({ schema: 1, channelSchema: 1, version, architectures: ["x64", "arm64"], installer: { name: installer, sha256, sha512, size: bytes.length } }, null, 2) + "\n");
  windowsBootstraps(dir);
}

/** Windows' bootstrap and its two one-liners, which name no build. */
export function windowsBootstraps(dir) {
  cpSync(path.join(here, "../../packages/app-setup/src/deliver/install.ps1"), path.join(dir, "install-storytree.ps1"));
  writeFileSync(path.join(dir, "install-storytree.txt"), INSTALL_COMMAND);
  writeFileSync(path.join(dir, "install-storytree-development.txt"), "& ([scriptblock]::Create((Invoke-RestMethod 'https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.ps1'))) -Channel development\r\n");
}

/** The Mac one-liners: stable follows the owner's pin, development the latest release. */
export const MAC_INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.sh | sh\n";
const MAC_DEVELOPMENT_COMMAND = "curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.sh | sh -s -- --channel development\n";

export function macDeliveryAssets(dir, version) {
  const name = `storytree-0.3-${version}-mac-arm64.zip`;
  const bytes = readFileSync(path.join(dir, name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(path.join(dir, "storytree-delivery-mac.json"), JSON.stringify({ version, macos: { arm64: { name, sha256, size: bytes.length } } }, null, 2) + "\n");
  macBootstraps(dir);
}

/** The shell bootstrap the Mac and Linux share, and the Mac's two one-liners, which name no build. */
export function macBootstraps(dir) {
  cpSync(path.join(here, "../../packages/app-setup/src/deliver/install.sh"), path.join(dir, "install-storytree.sh"));
  writeFileSync(path.join(dir, "install-storytree-mac.txt"), MAC_INSTALL_COMMAND);
  writeFileSync(path.join(dir, "install-storytree-mac-development.txt"), MAC_DEVELOPMENT_COMMAND);
}

export function linuxDeliveryAssets(dir, version) {
  const name = `storytree-0.3-${version}-linux-x86_64.AppImage`;
  const bytes = readFileSync(path.join(dir, name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(path.join(dir, "storytree-delivery-linux.json"), JSON.stringify({ version, linux: { x64: { name, sha256, size: bytes.length } } }, null, 2) + "\n");
}
