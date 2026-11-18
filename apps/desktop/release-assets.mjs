import { WINDOWS_ARCHITECTURES, windowsInstaller } from "./delivery-assets.mjs";

export const PLATFORMS = {
  windows: {
    required: (version) => [
      ...WINDOWS_ARCHITECTURES.flatMap((arch) => [windowsInstaller(version, arch), `${windowsInstaller(version, arch)}.blockmap`]), "latest.yml",
      "install-storytree.ps1", "install-storytree.txt", "install-storytree-alpha.txt", "storytree-delivery.json",
    ],
    uploads: (name) => /^(install-storytree(-alpha)?\.(ps1|txt)|storytree-delivery\.json|latest\.yml)$/.test(name) || /\.(exe|exe\.blockmap)$/.test(name),
  },
  mac: {
    required: (version) => [
      `storytree-0.3-${version}-mac-arm64.zip`, `storytree-0.3-${version}-mac-arm64.zip.blockmap`, "latest-mac.yml",
      "install-storytree.sh", "install-storytree-mac.txt", "install-storytree-mac-alpha.txt", "storytree-delivery-mac.json",
    ],
    uploads: (name) => /^(latest-mac\.yml|install-storytree\.sh|install-storytree-mac(-alpha)?\.txt|storytree-delivery-mac\.json)$/.test(name) || /\.zip(\.blockmap)?$/.test(name),
  },
  linux: {
    required: (version) => [`storytree-0.3-${version}-linux-x86_64.AppImage`, "latest-linux.yml", "storytree-delivery-linux.json"],
    uploads: (name) => name === "latest-linux.yml" || name === "storytree-delivery-linux.json" || name.endsWith(".AppImage"),
  },
};

export function hostPlatform(platform = process.platform) {
  const name = { win32: "windows", darwin: "mac", linux: "linux" }[platform];
  if (!name) throw new Error(`No release platform is packaged on ${platform}`);
  return name;
}

export function platformUploads(platform, files) {
  return files.filter((name) => PLATFORMS[platform].uploads(name));
}

export function missingAssets(names, version) {
  const present = new Set(names);
  const missing = {};
  for (const [platform, { required }] of Object.entries(PLATFORMS)) {
    const absent = required(version).filter((name) => !present.has(name));
    if (absent.length > 0) missing[platform] = absent;
  }
  return missing;
}

export function freshPlatforms(names, version) {
  const missing = missingAssets(names, version);
  return Object.keys(PLATFORMS).filter((platform) => !(platform in missing));
}
