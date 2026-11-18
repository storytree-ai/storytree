// Capability 4 · Read the license.
import { readFile } from "node:fs/promises";

export function readShippedLicense(resource: string): Promise<string> { return readFile(resource, "utf8"); }
