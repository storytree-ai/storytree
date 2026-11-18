// Capability 1 · Lifecycle
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export interface LaunchRecord {
  readonly command: string;
  readonly args: string[];
}

export interface LaunchOptions {
  readonly appPath: string;
  readonly execPath: string;
  readonly packaged?: { readonly portableFile?: string; readonly appImage?: string; readonly sandboxOff?: boolean };
  readonly installedHere: boolean;
}

export function launchToRecord({ appPath, execPath, packaged, installedHere }: LaunchOptions): LaunchRecord | undefined {
  if (packaged?.appImage !== undefined) return { command: packaged.appImage, args: packaged.sandboxOff === true ? ["--no-sandbox"] : [] };
  if (packaged !== undefined) return { command: packaged.portableFile ?? execPath, args: [] };
  if (installedHere) return undefined;
  return { command: execPath, args: [appPath] };
}

export interface BuildOptions {
  readonly appPath: string;
  readonly sha?: string;
  readonly packaged?: { readonly version: string; readonly commit?: string };
}

export function buildLabel({ appPath, sha, packaged }: BuildOptions): string {
  if (packaged !== undefined) return `version ${packaged.version}${packaged.commit === undefined ? "" : ` (commit ${packaged.commit.slice(0, 7)})`}`;
  const short = sha === undefined ? "" : ` ${sha.slice(0, 7)}`;
  return `development build${short} from ${path.resolve(appPath, "..", "..")} (does not update itself)`;
}

export async function checkoutSha(dir: string): Promise<string> {
  const { stdout } = await promisify(execFile)("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
  return stdout.trim();
}
