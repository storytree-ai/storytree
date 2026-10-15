// What each platform contributes to a release (4.6). Every platform's runner uploads its own set into one draft. The
// draft publishes with each platform whose required set is there; a platform whose set is not carries its last good
// build's feed and delivery entry forward (packages/app/src/updates/release-carry.ts), so an installed app on any
// platform never meets a release that lacks its own update feed, and one platform's failure holds only that platform.
// A new platform is one more entry here.
export const PLATFORMS = {
  windows: {
    required: (version) => [
      `storytree-0.3-${version}-setup.exe`, `storytree-0.3-${version}-setup.exe.blockmap`, "latest.yml",
      // The one-command delivery: its bootstrap, one-liners and installer checksum manifest.
      "install-storytree.ps1", "install-storytree.txt", "install-storytree-development.txt", "storytree-delivery.json",
    ],
    uploads: (name) => /^(install-storytree(-development)?\.(ps1|txt)|storytree-delivery\.json|latest\.yml)$/.test(name) || /\.(exe|exe\.blockmap)$/.test(name),
  },
  mac: {
    required: (version) => [
      // The zip is what electron-updater fetches; the dmg is what a browser downloads.
      `storytree-0.3-${version}-mac-arm64.zip`, `storytree-0.3-${version}-mac-arm64.zip.blockmap`,
      `storytree-0.3-${version}-arm64.dmg`, `storytree-0.3-${version}-arm64.dmg.blockmap`, "latest-mac.yml",
      // The Mac one-command delivery; its manifest entry is merged into storytree-delivery.json on publish.
      "install-storytree.sh", "install-storytree-mac.txt", "install-storytree-mac-development.txt", "storytree-delivery-mac.json",
    ],
    uploads: (name) => /^(latest-mac\.yml|install-storytree\.sh|install-storytree-mac(-development)?\.txt|storytree-delivery-mac\.json)$/.test(name) || /\.(zip|dmg)(\.blockmap)?$/.test(name),
  },
  linux: {
    // An AppImage carries its blockmap inside it, so its update feed and its delivery entry are its only companions.
    required: (version) => [`storytree-0.3-${version}-linux-x86_64.AppImage`, "latest-linux.yml", "storytree-delivery-linux.json"],
    uploads: (name) => name === "latest-linux.yml" || name === "storytree-delivery-linux.json" || name.endsWith(".AppImage"),
  },
};

/** The platform whose assets this runner builds and uploads. */
export function hostPlatform(platform = process.platform) {
  const name = { win32: "windows", darwin: "mac", linux: "linux" }[platform];
  if (!name) throw new Error(`No release platform is packaged on ${platform}`);
  return name;
}

/** The release directory's files this platform uploads: its installers, update feed and their blockmaps. */
export function platformUploads(platform, files) {
  return files.filter((name) => PLATFORMS[platform].uploads(name));
}

/** Each platform still missing part of its required set, with what is missing; {} when every platform's build is in. */
export function missingAssets(names, version) {
  const present = new Set(names);
  const missing = {};
  for (const [platform, { required }] of Object.entries(PLATFORMS)) {
    const absent = required(version).filter((name) => !present.has(name));
    if (absent.length > 0) missing[platform] = absent;
  }
  return missing;
}

/** The platforms whose whole set for this version is in the release: the ones it publishes new builds for. */
export function freshPlatforms(names, version) {
  const missing = missingAssets(names, version);
  return Object.keys(PLATFORMS).filter((platform) => !(platform in missing));
}
