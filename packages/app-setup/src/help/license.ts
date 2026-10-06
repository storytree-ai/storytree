/** Capability 4 · Read the license. */
import { readFile } from "node:fs/promises";

/** The frame supplies the current installation's resource path; no checkout, cache or network. */
export function readShippedLicense(resource: string): Promise<string> { return readFile(resource, "utf8"); }
