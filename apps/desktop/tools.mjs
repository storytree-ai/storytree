// Packaging adapter: reuse the agent link's build, then stage the host platform's native runtimes:
// both Windows architectures on Windows, Apple Silicon on macOS.
import { buildBins, buildLauncher, LAUNCHER_PROGRAM, stageNativeProbes } from "@storytree/app-setup/bins";
import { macRuntime, NODE_VERSION, stageRuntime, windowsRuntime, writePayloadManifest } from "@storytree/app-setup/deliver";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Each step's time, for the Windows delivery proof's slow-step diagnosis. Written straight to stdout,
// so a step still running when a deadline kills the process shows as started and not finished.
function timed(name, run) {
  const started = performance.now();
  observe(`${name} START`);
  const done = () => observe(`${name} done (${Math.round(performance.now() - started)} ms)`);
  const result = run();
  if (!(result instanceof Promise)) return done(), result;
  return result.then((value) => (done(), value));
}

function observe(message) {
  try { writeSync(1, `tools: ${message}\n`); } catch { console.log(`tools: ${message}`); }
}

export async function buildToolBundle(outdir, { platform = process.platform, arch = process.arch, release } = {}) {
  mkdirSync(outdir, { recursive: true });
  // stageTools builds each payload's own `storytree` launcher; the host's here would only be overwritten.
  await timed("agent link commands (buildBins)", () => buildBins(outdir, { release, launcher: false }));
  await timed("delivery helper bundle", () => build({
    stdin: {
      contents: 'import { runDeliveryCommand } from "@storytree/app-setup/deliver"; runDeliveryCommand().catch(error => { console.error(error.message); process.exitCode = 1; });',
      resolveDir: here,
      sourcefile: "storytree-deliver.ts",
    },
    outfile: path.join(outdir, "storytree-deliver.mjs"),
    bundle: true, platform: "node", format: "esm", target: "node24", logLevel: "warning",
    banner: { js: 'import { createRequire as __storytreeRequire } from "node:module"; const require = __storytreeRequire(import.meta.url);' },
    external: ["pg-native", "pg-cloudflare", "cloudflare:sockets", "@google-cloud/cloud-sql-connector", "@huggingface/transformers"],
  }));
  timed(`embedding runtime ${platform}/${arch}`, () => stageEmbeddingRuntime(outdir, platform, arch));
}

/** Copy the locked Node runtime, never model weights or another target's native libraries.
 * Transformers' Node distribution already bundles its tokenizer and browser JS dependencies.
 * Sharp is still a mandatory import, even for a text-only pipeline, so its target must ship too.
 */
export function stageEmbeddingRuntime(outdir, platform = process.platform, arch = process.arch) {
  const modules = path.join(outdir, "node_modules");
  // A Windows payload may be restaged from the host's bundle; discard the previous sharp target.
  rmSync(path.join(modules, "@img"), { recursive: true, force: true });
  const staged = new Map();
  const packageRoot = (name, require) => {
    // Some native packages export only their binding, and hide even package.json.
    for (const modules of require.resolve.paths(name) ?? []) {
      const dir = path.join(modules, name);
      if (existsSync(path.join(dir, "package.json"))) return realpathSync(dir);
    }
    throw new Error(`Cannot find the installed ${name} package`);
  };
  const copyPackage = (name, require) => {
    const source = packageRoot(name, require);
    const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
    if (staged.has(name)) {
      if (staged.get(name).version !== manifest.version) throw new Error(`Conflicting runtime versions of ${name}`);
      return;
    }
    const dest = path.join(modules, name);
    const started = performance.now();
    observe(`copy ${name} START`);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const copy = (relative) => cpSync(path.join(source, relative), path.join(dest, relative), {
      recursive: true, dereference: true, filter: (file) => !file.endsWith(".map"),
    });
    const isRuntime = ["@huggingface/transformers", "onnxruntime-node", "onnxruntime-common", "sharp"].includes(name);
    for (const entry of readdirSync(source)) {
      if (entry === "node_modules") continue;
      if (!isRuntime || entry === "package.json" || /^(LICENSE|NOTICE|COPYING)/i.test(entry)) copy(entry);
    }
    if (name === "@huggingface/transformers") {
      mkdirSync(path.join(dest, "dist"));
      for (const entry of ["dist/transformers.node.mjs", "dist/transformers.node.cjs"]) copy(entry);
    } else if (isRuntime) copy("dist");
    if (name === "onnxruntime-node") {
      const native = `bin/napi-v6/${platform}/${arch}`;
      mkdirSync(path.join(dest, native), { recursive: true });
      const library = { win32: "onnxruntime.dll", linux: "libonnxruntime.so.1", darwin: "libonnxruntime.1.dylib" }[platform];
      if (!library) throw new Error(`Unsupported embedding runtime platform: ${platform}`);
      for (const entry of ["onnxruntime_binding.node", library]) copy(`${native}/${entry}`);
    }
    if (name.startsWith("onnxruntime-")) {
      // These npm distributions omit the upstream license. Keep it with the shipped runtime.
      cpSync(path.join(here, "licenses", "onnxruntime-LICENSE"), path.join(dest, "LICENSE"));
      cpSync(path.join(here, "licenses", "onnxruntime-ThirdPartyNotices.txt"), path.join(dest, "ThirdPartyNotices.txt"));
    }
    staged.set(name, { version: manifest.version, bytes: directoryBytes(dest) });
    observe(`copy ${name} done (${Math.round(performance.now() - started)} ms, ${staged.get(name).bytes} bytes)`);
    const dependencies = name === "@huggingface/transformers" ? ["onnxruntime-node", "onnxruntime-common", "sharp"]
      : name === "onnxruntime-node" ? ["onnxruntime-common"] // downloader dependencies are install-time only
      : Object.keys(manifest.dependencies ?? {});
    if (name === "sharp") {
      const target = `${platform}-${arch}`;
      dependencies.push(`@img/sharp-${target}`);
      const vips = `@img/sharp-libvips-${target}`;
      if (manifest.optionalDependencies?.[vips]) dependencies.push(vips);
    }
    const from = createRequire(path.join(source, "package.json"));
    for (const dependency of dependencies) copyPackage(dependency, from);
  };
  copyPackage("@huggingface/transformers", createRequire(import.meta.url));
  const bytes = [...staged.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`embedding runtime ${platform}/${arch}: ${bytes} bytes (${(bytes / 1024 ** 2).toFixed(2)} MiB); no model weights`);
  return { platform, arch, bytes, packages: Object.fromEntries(staged) };
}

function directoryBytes(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const file = path.join(dir, entry.name);
    return sum + (entry.isDirectory() ? directoryBytes(file) : statSync(file).size);
  }, 0);
}

export async function stageTools(platform = process.platform) {
  const root = path.join(here, "dist", "agent-tools");
  const common = path.join(root, "common");
  rmSync(root, { recursive: true, force: true });
  // A release's packaging (dist.mjs, with STORYTREE_RELEASE_VERSION) stamps its 0.3.<n> into the installed command.
  const version = process.env.STORYTREE_RELEASE_VERSION;
  const release = version === undefined ? undefined : { version, commit: execFileSync("git", ["-C", here, "rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim() };
  // Apple Silicon only (decision_dfb6e40aa9f7); sharp's darwin binaries install only on a Mac, so a Mac payload is staged there.
  const archs = { win32: ["x64", "arm64"], darwin: ["arm64"] }[platform];
  if (!archs) throw new Error(`No desktop tool payload for ${platform}`);
  await buildToolBundle(common, { platform, arch: archs[0], release });
  for (const arch of archs) {
    const dir = path.join(root, arch);
    cpSync(common, dir, { recursive: true });
    if (arch !== archs[0]) stageEmbeddingRuntime(dir, platform, arch);
    await stageNativeProbes(dir, platform, arch);
    if (platform === "win32") {
      // The `storytree` command for this architecture: a program of its own (ADR-0854).
      buildLauncher(path.join(dir, LAUNCHER_PROGRAM), arch);
      await stageRuntime(path.join(dir, "node.exe"), windowsRuntime(arch));
    } else await stageRuntime(path.join(dir, "node"), macRuntime(arch));
    const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${NODE_VERSION}/LICENSE`, { signal: AbortSignal.timeout(30_000) });
    if (!license.ok) throw new Error(`Could not download the Node ${NODE_VERSION} license`);
    writeFileSync(path.join(dir, "NODE-LICENSE"), await license.text());
    if (platform === "darwin") signMachO(dir);
    writePayloadManifest(dir, arch, NODE_VERSION, platform);
    console.log(`staged ${platform} ${arch}: Node ${NODE_VERSION} (SHA-256 verified), licenses, complete buildBins output, target Koffi probes, ${platform === "win32" ? "command launcher, " : ""}embedding runtime and delivery helper`);
  }
  rmSync(common, { recursive: true, force: true });
}

/**
 * Sign every Mach-O file in a Mac payload here, before its manifest records their digests: signing
 * rewrites a binary, so electron-builder leaves agent-tools alone (package.json's mac.signIgnore).
 * Hardened runtime with the app's entitlements, as notarisation requires of every binary. Ad-hoc ("-")
 * until a Developer ID is configured (increment_9d05fb8a164b), named by STORYTREE_MAC_IDENTITY.
 */
export function signMachO(dir, identity = process.env.STORYTREE_MAC_IDENTITY ?? "-") {
  const entitlements = path.join(here, "entitlements.mac.plist");
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && isMachO(file)) {
        execFileSync("codesign", ["--force", "--sign", identity, "--options", "runtime", "--entitlements", entitlements, ...(identity === "-" ? [] : ["--timestamp"]), file], { stdio: "inherit" });
      }
    }
  };
  timed(`sign Mach-O files (${identity === "-" ? "ad-hoc" : identity})`, () => visit(dir));
}

function isMachO(file) {
  const header = Buffer.alloc(4);
  const fd = openSync(file, "r");
  try { if (readSync(fd, header, 0, 4, 0) < 4) return false; } finally { closeSync(fd); }
  // 64-bit Mach-O in either byte order, or a universal (fat) binary.
  return [0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(header.readUInt32BE(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await stageTools();
