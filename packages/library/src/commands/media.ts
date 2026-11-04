/**
 * Capability 17 · The library's commands: the `media` family (17.18, ADR-1234 D3), mounted beside `library`, `adr` and
 * `fyi`. Durable media (an approved look, a build's input) is kept in the library beside the note that cites it:
 * `attach` keeps a file from the caller's folder, `list` names a record's files, and `get` saves one back, through the
 * library's attachMedia, media and mediaFile. Each is also a tool (attach_media, list_media, fetch_media), so an agent
 * keeps and fetches a file by its path as a person does; a file's bytes never travel in an answer.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { verb, VerbRefusal, type VerbContext, type VerbFamily } from "../verbs/verb.js";

/** The media type a file's extension says, for a file attached without one: application/octet-stream when it says none. */
const TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".json": "application/json", ".gz": "application/gzip", ".pdf": "application/pdf",
};

const attach = verb({
  command: {
    family: "media",
    name: "attach",
    summary: "keep a file beside the record that cites it: an approved look or a build's input, never evidence",
    usage: "media attach <record> <file> [--name <name>] [--type <media type>] [--replace]",
  },
  tool: {
    name: "attach_media",
    description: "Keep a file from this folder in the library beside the record that cites it (durable media: an owner-approved look or an input a build, test or script reads; evidence goes to the evidence bucket instead). Up to 10 MB; its type is read from its extension unless given. The same bytes again change nothing; other bytes under the same name are refused unless replace.",
  },
  inputs: {
    record: { kind: "text", word: 0, describe: "the id of the live record that cites the file" },
    file: { kind: "text", word: 1, describe: "the file to keep, a path from this folder" },
    name: { kind: "text", optional: true, describe: "the name to keep it under; the file's own name when left out" },
    type: { kind: "text", optional: true, describe: "its media type, such as image/png; read from the file's extension when left out" },
    replace: { kind: "switch", describe: "keep these bytes in place of other bytes already kept under the name" },
  },
  writes: true,
  async act({ record, file, name, type, replace }, context: VerbContext) {
    const from = path.resolve(context.folder, file);
    let bytes: Buffer;
    try {
      bytes = readFileSync(from);
    } catch (error) {
      throw new VerbRefusal(`cannot read ${from}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`);
    }
    const kept = name ?? path.basename(from);
    let attached;
    try {
      attached = await context.library.attachMedia(record, { name: kept, type: type ?? TYPES[path.extname(kept).toLowerCase()] ?? "application/octet-stream", bytes }, { ...context.writer, replace });
    } catch (error) {
      throw new VerbRefusal((error as Error).message);
    }
    const said = { added: "Attached", same: "Already held, unchanged:", replaced: "Replaced" }[attached.outcome];
    return {
      text: `${said} ${attached.name} (${attached.type}, ${attached.size} bytes, sha256 ${attached.sha256.slice(0, 12)}…) to ${record}`,
      data: { ...attached },
      next: [{ command: `media list ${record}`, tool: "list_media", why: "the files kept beside it" }],
    };
  },
});

const list = verb({
  command: { family: "media", name: "list", summary: "the files kept beside a record, with their type, size and hash", usage: "media list <record>" },
  tool: { name: "list_media", description: "The files kept in the library beside a record, by name, with each one's media type, size, SHA-256 and when it was added." },
  inputs: { record: { kind: "text", word: 0, describe: "the record's id" } },
  async act({ record }, context: VerbContext) {
    const files = await context.library.media(record);
    if (files.length === 0) return { text: `${record} holds no media.` };
    const lines = files.map((one) => `  ${one.name}  ${one.type}  ${one.size} bytes  ${one.sha256.slice(0, 12)}  added ${one.addedAt.slice(0, 16).replace("T", " ")}${one.addedBy === undefined ? "" : ` by ${one.addedBy}`}`);
    return {
      text: [`Media kept beside ${record} (${files.length}):`, ...lines].join("\n"),
      data: { media: files },
      next: [{ command: `media get ${record} <name> --out <file>`, tool: "fetch_media", why: "save one back to a file" }],
    };
  },
});

const get = verb({
  command: { family: "media", name: "get", summary: "save a file kept beside a record back to a file, exactly", usage: "media get <record> <name> --out <file>" },
  tool: { name: "fetch_media", description: "Save a file kept in the library beside a record to a path in this folder, byte for byte, making its folder; the answer says where, with its type, size and SHA-256." },
  inputs: {
    record: { kind: "text", word: 0, describe: "the record's id" },
    name: { kind: "text", word: 1, describe: "the name the file is kept under" },
    out: { kind: "text", describe: "where to save it, a path from this folder" },
  },
  async act({ record, name, out }, context: VerbContext) {
    const file = await context.library.mediaFile(record, name);
    if (file === null) {
      const held = (await context.library.media(record)).map((one) => one.name);
      throw new VerbRefusal(`${record} holds no file named ${name}${held.length === 0 ? "; it holds no media" : `; it holds ${held.join(", ")}`}`);
    }
    const to = path.resolve(context.folder, out);
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, file.bytes);
    const { bytes: _bytes, ...entry } = file;
    return { text: `Saved ${name} (${file.type}, ${file.size} bytes, sha256 ${file.sha256.slice(0, 12)}…) to ${to}`, data: { ...entry, savedTo: to } };
  },
});

/** Its section of the habits card (ADR-1021, the guidance kind): where a file worth keeping goes. */
export const mediaGuidance: readonly string[] = [
  "Keep a file worth keeping in the library: `attach_media` keeps an approved look or an input a build or test reads (never evidence) beside the note that cites it; `list_media` names a note's files and `fetch_media` saves one back.",
];

export const MEDIA_FAMILY: VerbFamily = {
  name: "media",
  summary: "durable media kept beside the records that cite them: attach, list, get",
  order: 3.6,
  verbs: [attach, list, get],
};
