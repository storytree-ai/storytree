// Capability 17 · The library's commands
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { refusing, verb, VerbRefusal, type VerbAnswer, type VerbContext, type VerbFamily } from "./kit/index.js";
import type { MediaEntry } from "./media.js";

const TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
};

export const mediaGuidance: readonly string[] = [
  "Keep a picture or file beside the record it shows with media attach (attach_media): an approved look's screenshots beside its decision, a run's log beside its friction.",
  "A record's media is listed with media list (list_media) and saved back exactly with media get (fetch_media); a file is at most 10 MB.",
];

function entrySaid({ type, size, sha256 }: MediaEntry): string {
  return `${type}, ${size} bytes, sha256 ${sha256.slice(0, 12)}…`;
}

const ATTACH = verb({
  command: { family: "media", name: "attach", summary: "keep a file from this folder beside a record", usage: "media attach <record> <file> [--name <name>] [--type <type>] [--replace]" },
  tool: { name: "attach_media", description: "Keep a file from this folder beside a record, its type read from its extension unless given; replace puts other bytes in place of a file of the same name" },
  inputs: {
    record: { kind: "text", word: 0, describe: "The record to keep it beside" },
    file: { kind: "text", word: 1, describe: "The file, in this folder" },
    name: { kind: "text", optional: true, describe: "The name to keep it under (its file name unless given)" },
    type: { kind: "text", optional: true, describe: "Its media type (read from its extension unless given)" },
    replace: { kind: "switch", describe: "Put these bytes in place of a file of the same name" },
  },
  writes: true,
  async act({ record, file, name, type, replace }, context: VerbContext): Promise<VerbAnswer> {
    const from = path.resolve(context.folder, file);
    let bytes: Buffer;
    try {
      bytes = readFileSync(from);
    } catch (error) {
      throw new VerbRefusal(`cannot read ${from}: ${(error as Error).message}`);
    }
    const kept = name ?? path.basename(from);
    const media = { name: kept, type: type ?? TYPES[path.extname(kept).toLowerCase()] ?? "application/octet-stream", bytes: new Uint8Array(bytes) };
    const attached = await refusing(() => context.library.attachMedia(record, media, { ...context.writer, replace }));
    const said = `${kept} (${entrySaid(attached)})`;
    const text = attached.outcome === "same" ? `Already held, unchanged: ${said} on ${record}.` : attached.outcome === "replaced" ? `Replaced ${said} on ${record}.` : `Attached ${said} to ${record}.`;
    return { text, data: { ...attached } };
  },
});

const LIST = verb({
  command: { family: "media", name: "list", summary: "the files kept beside a record", usage: "media list <record>" },
  tool: { name: "list_media", description: "List the files kept beside a record, with their type, size and hash" },
  inputs: { record: { kind: "text", word: 0, describe: "The record whose media to list" } },
  async act({ record }, context: VerbContext): Promise<VerbAnswer> {
    const held = await context.library.media(record);
    if (held.length === 0) return { text: `${record} holds no media.`, data: { media: [] } };
    const lines = held.map(({ name, type, size, sha256 }) => `  ${name}  ${type}  ${size} bytes  ${sha256.slice(0, 12)}`);
    return { text: [`${record} holds ${held.length} ${held.length === 1 ? "file" : "files"}:`, ...lines].join("\n"), data: { media: held } };
  },
});

const GET = verb({
  command: { family: "media", name: "get", summary: "save a file kept beside a record back into this folder", usage: "media get <record> <name> --out <file>" },
  tool: { name: "fetch_media", description: "Save a file kept beside a record into this folder, exactly as kept" },
  inputs: {
    record: { kind: "text", word: 0, describe: "The record it is kept beside" },
    name: { kind: "text", word: 1, describe: "The name it is kept under" },
    out: { kind: "text", describe: "Where to save it, in this folder" },
  },
  async act({ record, name, out }, context: VerbContext): Promise<VerbAnswer> {
    const file = await context.library.mediaFile(record, name);
    if (file === null) {
      const held = (await context.library.media(record)).map((one) => one.name);
      throw new VerbRefusal(`${record} keeps no ${name}: ${held.length === 0 ? "it holds no media" : `it holds ${held.join(", ")}`}`);
    }
    const to = path.resolve(context.folder, out);
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, file.bytes);
    return { text: `Saved ${name} (${entrySaid(file)}) from ${record} to ${to}.`, data: { path: to } };
  },
});

export const MEDIA_FAMILY: VerbFamily = { name: "media", summary: "files kept beside records: attach, list, get", order: 9, verbs: [ATTACH, LIST, GET] };
