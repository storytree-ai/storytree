/**
 * Capability 8 · Code survey: a project's shared stores, the declared layer (ADR-1332 D1, D2 (1)).
 *
 * - A store is a medium plus an address, named the OpenLineage way (postgres://host/db, redis://host), with no
 *   credentials or port. It is identified only from deterministic evidence: a compose file's services whose image is a
 *   store's (Postgres, MySQL, Redis, MongoDB and their common builds), and connection strings in the configuration the
 *   repository commits (.env files, .ini, .cfg, .conf, .toml and YAML), or in a compose service's environment. Evidence
 *   is listed on its store, never a store of its own.
 * - A connection whose host is a compose service's name is that service's store; one at localhost on a port a single
 *   compose service of its medium publishes is that service's too. Compose's `${NAME}`, `${NAME:-default}` and `$NAME`
 *   are filled from the .env beside the compose file, else their default; an address still holding one is left out.
 * - A SQL store's tables, with their columns and foreign keys, come from the .sql files' CREATE TABLE, ALTER TABLE and
 *   DROP TABLE statements, parsed (comments, strings and quoted names are tokens, never text to match), applied in
 *   path order, numbers compared as numbers. A down migration (a file named down, rollback or revert, or in a down
 *   folder) is left out. A file goes to the SQL store whose compose service mounts a folder holding it, else to the
 *   project's only SQL store, else to none. No code is linked to a store or table: that is ADR-1332's later layers.
 */
import path from "node:path";

/** A column of a table, its type as the migration wrote it, lower-cased and compacted. */
export type StoreColumn = { readonly name: string; readonly type: string };
/** A foreign key: the table's columns, the table they reference, and its columns there (empty when the key names none). */
export type StoreForeignKey = { readonly columns: readonly string[]; readonly table: string; readonly references: readonly string[] };
/** A table of a SQL store, and the migration files that made or changed it, in the order they were applied. */
export type StoreTable = { readonly name: string; readonly columns: readonly StoreColumn[]; readonly foreignKeys: readonly StoreForeignKey[]; readonly from: readonly string[] };
/** A piece of evidence for a store: the file, and what in it names the store. */
export type StoreEvidence = { readonly file: string; readonly says: string };
export type StoreMedium = "postgres" | "mysql" | "redis" | "mongodb";
/** A shared store: its address, its medium, the evidence naming it, and (for a SQL store) its tables. */
export type SharedStore = { readonly address: string; readonly medium: StoreMedium; readonly evidence: readonly StoreEvidence[]; readonly tables: readonly StoreTable[] };

type File = { readonly path: string; readonly text: string };

const COMPOSE = /^(?:docker-)?compose(?:\.[\w.-]+)?\.ya?ml$/i;
const CONFIG = /^\.env(?:\..+)?$|\.env$|\.(?:ini|cfg|conf|toml|ya?ml)$/i;
const SQL = /\.sql$/i;
const DOWN = /(?:^|\/)(?:down|rollback|revert)\/|(?:^|[._/-])(?:down|rollback|revert)\.sql$/i;

/** Whether a file's name makes it evidence the stores are read from. */
export function readsForStores(name: string): boolean {
  return COMPOSE.test(name) || CONFIG.test(name) || SQL.test(name);
}

const IMAGES: readonly [RegExp, StoreMedium][] = [
  [/^(?:postgres(?:ql)?|postgis|pgvector|timescaledb(?:-ha)?)$/, "postgres"],
  [/^(?:mysql|mariadb|percona(?:-server)?)$/, "mysql"],
  [/^(?:redis(?:-stack(?:-server)?)?|valkey|keydb)$/, "redis"],
  [/^mongo(?:db)?$/, "mongodb"],
];
const SCHEMES: Readonly<Record<string, StoreMedium>> = { postgres: "postgres", postgresql: "postgres", mysql: "mysql", mariadb: "mysql", redis: "redis", rediss: "redis", mongodb: "mongodb" };
const DEFAULT_PORTS: Readonly<Record<StoreMedium, string>> = { postgres: "5432", mysql: "3306", redis: "6379", mongodb: "27017" };
const LOCAL = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "host.docker.internal"]);
const SQL_MEDIA = new Set<StoreMedium>(["postgres", "mysql"]);

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Paths compared with their runs of digits as numbers, so 2_x.sql comes before 10_x.sql. */
function byPath(a: string, b: string): number {
  const split = (text: string) => text.split(/(\d+)/);
  const [x, y] = [split(a), split(b)];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const [p, q] = [x[i]!, y[i]!];
    if (p === q) continue;
    if (i % 2 === 1) return Number(p) - Number(q) || byText(p, q);
    return byText(p, q);
  }
  return x.length - y.length;
}

// ---- A compose file's YAML: block mappings and sequences, flow sequences and plain or quoted scalars. ----

type Yaml = string | null | readonly Yaml[] | { readonly [key: string]: Yaml };
type Line = { readonly indent: number; readonly text: string };

/** A line with its comment removed: a # at its start or after a space, outside quotes. */
function uncommented(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote !== "") {
      if (c === quote) quote = "";
    } else if (c === "\"" || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function scalar(text: string): Yaml {
  const value = text.trim();
  if (value === "" || value === "~" || value === "null") return null;
  if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1).split(",").map((part) => scalar(part)).filter((part) => part !== null);
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

const KEY = /^("[^"]*"|'[^']*'|[^\s"'#\-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/;

/** The block starting at `lines[at]`, all of whose lines sit at `indent`, and the index after it. */
function block(lines: readonly Line[], at: number, indent: number): [Yaml, number] {
  const first = lines[at]!;
  if (first.text === "-" || first.text.startsWith("- ")) {
    const items: Yaml[] = [];
    let i = at;
    while (i < lines.length && lines[i]!.indent === indent && (lines[i]!.text === "-" || lines[i]!.text.startsWith("- "))) {
      const rest = lines[i]!.text.slice(1);
      const body = rest.trimStart();
      if (body === "") {
        if (lines[i + 1] !== undefined && lines[i + 1]!.indent > indent) {
          const [value, next] = block(lines, i + 1, lines[i + 1]!.indent);
          items.push(value);
          i = next;
        } else {
          items.push(null);
          i += 1;
        }
      } else if (KEY.test(body)) {
        // A mapping in a sequence: its first entry shares the dash's line.
        const inner = indent + 1 + (rest.length - body.length);
        const shifted = [...lines.slice(0, i), { indent: inner, text: body }, ...lines.slice(i + 1)];
        const [value, next] = block(shifted, i, inner);
        items.push(value);
        i = next;
      } else {
        items.push(scalar(body));
        i += 1;
      }
    }
    return [items, i];
  }
  const map: Record<string, Yaml> = {};
  let i = at;
  while (i < lines.length && lines[i]!.indent === indent) {
    const found = KEY.exec(lines[i]!.text);
    if (found === null) {
      i += 1;
      continue;
    }
    const key = String(scalar(found[1]!) ?? "");
    const rest = (found[2] ?? "").trim();
    const next = lines[i + 1];
    if (rest === "" && next !== undefined && (next.indent > indent || (next.indent === indent && (next.text === "-" || next.text.startsWith("- "))))) {
      const [value, after] = block(lines, i + 1, next.indent);
      map[key] = value;
      i = after;
    } else if (/^[|>]/.test(rest)) {
      map[key] = "";
      i += 1;
      while (i < lines.length && lines[i]!.indent > indent) i += 1;
    } else {
      map[key] = scalar(rest);
      i += 1;
      while (i < lines.length && lines[i]!.indent > indent) i += 1;
    }
  }
  return [map, i];
}

/** A YAML document's top value, as far as a compose file needs it; null when it has none. */
function yaml(text: string): Yaml {
  const lines = text.split(/\r?\n/).map(uncommented).filter((line) => line.trim() !== "" && !/^(?:---|\.\.\.)\s*$/.test(line))
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  return lines.length === 0 ? null : block(lines, 0, lines[0]!.indent)[0];
}

const mapOf = (value: Yaml | undefined): { readonly [key: string]: Yaml } => (value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value) ? value as { readonly [key: string]: Yaml } : {});
const listOf = (value: Yaml | undefined): readonly Yaml[] => (Array.isArray(value) ? value : []);
const textOf = (value: Yaml | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/** A compose service's environment, given as a mapping or as a list of NAME=value. */
function environmentOf(service: { readonly [key: string]: Yaml }): [string, string][] {
  const given = service.environment;
  if (Array.isArray(given)) return given.flatMap((entry) => {
    const text = textOf(entry);
    const at = text?.indexOf("=") ?? -1;
    return text === undefined || at <= 0 ? [] : [[text.slice(0, at).trim(), text.slice(at + 1).trim()] as [string, string]];
  });
  return Object.entries(mapOf(given)).map(([name, value]) => [name, textOf(value) ?? ""] as [string, string]);
}

/** Compose's interpolation from `variables`: a name with no value and no default stays as written. */
function interpolate(text: string, variables: ReadonlyMap<string, string>): string {
  return text.replace(/\$\{([A-Za-z_]\w*)(?:(:?[-?])([^}]*))?\}|\$([A-Za-z_]\w*)/g, (whole, braced?: string, operator?: string, fallback?: string, bare?: string) => {
    const name = braced ?? bare!;
    const value = variables.get(name);
    if (value !== undefined && (value !== "" || operator !== ":-")) return value;
    return operator === ":-" || operator === "-" ? fallback ?? "" : whole;
  });
}

/** A .env file's NAME=value pairs. */
function dotenv(text: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const found = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(uncommented(line));
    if (found !== null) pairs.set(found[1]!, String(scalar(found[2]!) ?? ""));
  }
  return pairs;
}

// ---- Connection strings. ----

type Connection = { readonly medium: StoreMedium; readonly host: string; readonly port?: string; readonly database?: string };

const URL_TEXT = /\b([A-Za-z][\w+.-]*):\/\/([^\s"'`,;<>()]+)/g;

/** The store a connection string names, its credentials and options dropped; undefined when it names none plainly. */
function connectionOf(scheme: string, rest: string): Connection | undefined {
  const medium = SCHEMES[scheme.toLowerCase().replace(/\+.*$/, "")];
  if (medium === undefined) return undefined;
  const slash = rest.search(/[/?]/);
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const pathPart = slash < 0 ? "" : rest.slice(slash);
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1).split(",")[0]!;
  const found = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostPort);
  if (found === null || /[${}]/.test(found[1]!)) return undefined;
  const host = found[1]!.toLowerCase();
  const name = /^\/([^/?#]*)/.exec(pathPart)?.[1] ?? "";
  const database = medium === "redis" || name === "" || /[${}]/.test(name) ? undefined : decodeURIComponent(name);
  return { medium, host, ...(found[2] === undefined ? {} : { port: found[2] }), ...(database === undefined ? {} : { database }) };
}

/** Every connection string in `text`, with the name it is given on its line (a variable or key), when it has one. */
function connectionsIn(text: string): { connection: Connection; name?: string }[] {
  const found: { connection: Connection; name?: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(URL_TEXT)) {
      const connection = connectionOf(match[1]!, match[2]!);
      if (connection === undefined) continue;
      const name = /([A-Za-z_][\w.-]*)["']?\s*[:=]\s*["']?$/.exec(line.slice(0, match.index))?.[1];
      found.push(name === undefined ? { connection } : { connection, name });
    }
  }
  return found;
}

// ---- SQL migrations. ----

type Token = { readonly kind: "word" | "name" | "string" | "punct"; readonly text: string };

/** A .sql file's tokens: comments are dropped, strings (dollar-quoted too) are one token, and quoted names keep their case. */
function tokens(text: string): Token[] {
  const found: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const rest = text.slice(i);
    if (/\s/.test(c)) i += 1;
    else if (rest.startsWith("--")) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
    } else if (rest.startsWith("/*")) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === "'" || ((c === "E" || c === "e") && text[i + 1] === "'")) {
      let j = i + (c === "'" ? 1 : 2);
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" || text[j] === "\\" ? 2 : 1;
      found.push({ kind: "string", text: text.slice(i, j + 1) });
      i = j + 1;
    } else if (c === "\"" || c === "`") {
      let j = i + 1;
      let name = "";
      while (j < text.length && !(text[j] === c && text[j + 1] !== c)) {
        name += text[j] === c ? c : text[j]!;
        j += text[j] === c ? 2 : 1;
      }
      found.push({ kind: "name", text: name });
      i = j + 1;
    } else if (c === "$" && /^\$(?:[A-Za-z_]\w*)?\$/.test(rest)) {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(rest)![0];
      const end = text.indexOf(tag, i + tag.length);
      found.push({ kind: "string", text: "" });
      i = end < 0 ? text.length : end + tag.length;
    } else if (/[A-Za-z_\d]/.test(c)) {
      const word = /^[A-Za-z_\d][\w$]*/.exec(rest)![0];
      found.push({ kind: "word", text: word });
      i += word.length;
    } else {
      found.push({ kind: "punct", text: c });
      i += 1;
    }
  }
  return found;
}

const isWord = (token: Token | undefined, ...words: string[]): boolean => token?.kind === "word" && words.includes(token.text.toLowerCase());
const nameText = (token: Token): string => (token.kind === "name" ? token.text : token.text.toLowerCase());

/** The token lists between commas at depth 0 of `list`. */
function splitTop(list: readonly Token[]): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const token of list) {
    if (token.kind === "punct" && token.text === "(") depth += 1;
    if (token.kind === "punct" && token.text === ")") depth -= 1;
    if (depth === 0 && token.kind === "punct" && token.text === ",") parts.push([]);
    else parts.at(-1)!.push(token);
  }
  return parts.filter((part) => part.length > 0);
}

/** A possibly qualified name at `at`, its default schema dropped, and the index after it. */
function qualified(list: readonly Token[], at: number): [string | undefined, number] {
  const parts: string[] = [];
  let i = at;
  while (list[i] !== undefined && (list[i]!.kind === "word" || list[i]!.kind === "name")) {
    parts.push(nameText(list[i]!));
    if (list[i + 1]?.kind === "punct" && list[i + 1]!.text === ".") i += 2;
    else {
      i += 1;
      break;
    }
  }
  if (parts.length > 1 && ["public", "dbo"].includes(parts[0]!)) parts.shift();
  return [parts.length === 0 ? undefined : parts.join("."), i];
}

/** The names in a parenthesised list at `at`, and the index after it; none when there is no list there. */
function nameList(list: readonly Token[], at: number): [string[], number] {
  if (!(list[at]?.kind === "punct" && list[at]!.text === "(")) return [[], at];
  const close = list.findIndex((token, i) => i > at && token.kind === "punct" && token.text === ")");
  const end = close < 0 ? list.length : close;
  return [list.slice(at + 1, end).filter((token) => token.kind === "word" || token.kind === "name").map(nameText), end + 1];
}

const COLUMN_ENDS = ["constraint", "not", "null", "default", "primary", "unique", "check", "references", "generated", "collate", "auto_increment", "comment", "identity", "on", "as"];
const TABLE_CONSTRAINTS = ["constraint", "primary", "unique", "check", "foreign", "exclude", "key", "index", "fulltext", "spatial", "like", "period"];

/** A type's tokens as text: words lower-cased and spaced, brackets and what they hold packed. */
function typeText(list: readonly Token[]): string {
  let text = "";
  let depth = 0;
  for (const token of list) {
    const piece = token.kind === "word" ? token.text.toLowerCase() : token.text;
    if (token.kind === "punct" && (token.text === "(" || token.text === "[")) depth += 1;
    const spaced = text !== "" && depth === 0 && token.kind !== "punct" && !/[(\[]$/.test(text);
    text += (spaced ? " " : "") + piece;
    if (token.kind === "punct" && (token.text === ")" || token.text === "]")) depth -= 1;
  }
  return text;
}

type Key = { columns: string[]; table: string; references: string[]; name?: string };
type Table = { name: string; columns: StoreColumn[]; keys: Key[]; from: string[] };

/** A foreign key at `list`'s `at`, which is FOREIGN or REFERENCES; undefined when it is not one. */
function foreignKey(list: readonly Token[], at: number, columns: string[] | undefined, name?: string): Key | undefined {
  let i = at;
  let own = columns ?? [];
  if (isWord(list[i], "foreign")) {
    if (!isWord(list[i + 1], "key")) return undefined;
    [own, i] = nameList(list, i + 2);
  }
  if (!isWord(list[i], "references")) return undefined;
  const [table, after] = qualified(list, i + 1);
  if (table === undefined) return undefined;
  const [references] = nameList(list, after);
  return { columns: own, table, references, ...(name === undefined ? {} : { name }) };
}

/** A table constraint's foreign key, when it is one. */
function tableKey(list: readonly Token[]): Key | undefined {
  const named = isWord(list[0], "constraint") ? list[1] : undefined;
  const at = named === undefined ? 0 : 2;
  return foreignKey(list, at, undefined, named === undefined ? undefined : nameText(named));
}

/** A column definition: the column, and its foreign key when it references another table inline. */
function columnDefinition(list: readonly Token[]): { column: StoreColumn; key?: Key } | undefined {
  if (list[0] === undefined || (list[0].kind !== "word" && list[0].kind !== "name")) return undefined;
  const name = nameText(list[0]);
  let end = 1;
  let depth = 0;
  for (; end < list.length; end++) {
    const token = list[end]!;
    if (token.kind === "punct" && token.text === "(") depth += 1;
    if (token.kind === "punct" && token.text === ")") depth -= 1;
    if (depth === 0 && isWord(token, ...COLUMN_ENDS)) break;
  }
  const references = list.findIndex((token) => isWord(token, "references"));
  const key = references < 0 ? undefined : foreignKey(list, references, [name]);
  return { column: { name, type: typeText(list.slice(1, end)) }, ...(key === undefined ? {} : { key }) };
}

/** Applies one statement to `tables`, from the migration file `file`. */
function apply(statement: readonly Token[], tables: Map<string, Table>, file: string): void {
  const touched = (table: Table) => { if (table.from.at(-1) !== file) table.from.push(file); };
  if (isWord(statement[0], "create")) {
    let i = 1;
    if (isWord(statement[i], "or") && isWord(statement[i + 1], "replace")) i += 2;
    if (isWord(statement[i], "global", "local")) i += 1;
    if (isWord(statement[i], "temp", "temporary")) return;
    if (isWord(statement[i], "unlogged")) i += 1;
    if (!isWord(statement[i], "table")) return;
    i += 1;
    if (isWord(statement[i], "if") && isWord(statement[i + 1], "not") && isWord(statement[i + 2], "exists")) i += 3;
    const [name, after] = qualified(statement, i);
    if (name === undefined) return;
    const table: Table = { name, columns: [], keys: [], from: [file] };
    if (statement[after]?.kind === "punct" && statement[after]!.text === "(") {
      let depth = 0;
      let close = after;
      for (; close < statement.length; close++) {
        if (statement[close]!.kind === "punct" && statement[close]!.text === "(") depth += 1;
        if (statement[close]!.kind === "punct" && statement[close]!.text === ")" && --depth === 0) break;
      }
      for (const element of splitTop(statement.slice(after + 1, close))) {
        if (isWord(element[0], ...TABLE_CONSTRAINTS)) {
          const key = tableKey(element);
          if (key !== undefined) table.keys.push(key);
          continue;
        }
        const defined = columnDefinition(element);
        if (defined === undefined) continue;
        table.columns.push(defined.column);
        if (defined.key !== undefined) table.keys.push(defined.key);
      }
    }
    tables.set(name, table);
    return;
  }
  if (isWord(statement[0], "drop") && isWord(statement[1], "table")) {
    let i = 2;
    if (isWord(statement[i], "if") && isWord(statement[i + 1], "exists")) i += 2;
    for (const part of splitTop(statement.slice(i))) {
      const [name] = qualified(part, 0);
      if (name !== undefined) tables.delete(name);
    }
    return;
  }
  if (!(isWord(statement[0], "alter") && isWord(statement[1], "table"))) return;
  let i = 2;
  if (isWord(statement[i], "if") && isWord(statement[i + 1], "exists")) i += 2;
  if (isWord(statement[i], "only")) i += 1;
  const [name, after] = qualified(statement, i);
  const table = name === undefined ? undefined : tables.get(name);
  if (table === undefined) return;
  touched(table);
  for (const action of splitTop(statement.slice(after))) {
    if (isWord(action[0], "add")) {
      let at = 1;
      if (isWord(action[at], "column")) at += 1;
      if (isWord(action[at], "if") && isWord(action[at + 1], "not") && isWord(action[at + 2], "exists")) at += 3;
      const rest = action.slice(at);
      if (isWord(rest[0], ...TABLE_CONSTRAINTS)) {
        const key = tableKey(rest);
        if (key !== undefined) table.keys.push(key);
        continue;
      }
      const defined = columnDefinition(rest);
      if (defined === undefined) continue;
      table.columns = [...table.columns.filter((column) => column.name !== defined.column.name), defined.column];
      if (defined.key !== undefined) table.keys.push(defined.key);
    } else if (isWord(action[0], "drop")) {
      if (isWord(action[1], "constraint")) {
        const dropped = action[isWord(action[2], "if") ? 4 : 2];
        if (dropped !== undefined) table.keys = table.keys.filter((key) => key.name !== nameText(dropped));
        continue;
      }
      let at = isWord(action[1], "column") ? 2 : 1;
      if (isWord(action[at], "if") && isWord(action[at + 1], "exists")) at += 2;
      const dropped = action[at];
      if (dropped === undefined || isWord(dropped, ...TABLE_CONSTRAINTS)) continue;
      const column = nameText(dropped);
      table.columns = table.columns.filter((one) => one.name !== column);
      table.keys = table.keys.filter((key) => !key.columns.includes(column));
    } else if (isWord(action[0], "rename")) {
      if (isWord(action[1], "to")) {
        const [renamed] = qualified(action, 2);
        if (renamed === undefined) continue;
        tables.delete(table.name);
        for (const other of tables.values()) for (const key of other.keys) if (key.table === table.name) key.table = renamed;
        table.name = renamed;
        tables.set(renamed, table);
        continue;
      }
      if (isWord(action[1], "constraint")) continue;
      const at = isWord(action[1], "column") ? 2 : 1;
      if (action[at] === undefined || !isWord(action[at + 1], "to") || action[at + 2] === undefined) continue;
      const [from, to] = [nameText(action[at]!), nameText(action[at + 2]!)];
      table.columns = table.columns.map((column) => (column.name === from ? { ...column, name: to } : column));
      for (const key of table.keys) key.columns = key.columns.map((column) => (column === from ? to : column));
      for (const other of tables.values()) for (const key of other.keys) if (key.table === table.name) key.references = key.references.map((column) => (column === from ? to : column));
    } else if (isWord(action[0], "alter")) {
      const at = isWord(action[1], "column") ? 2 : 1;
      const typed = isWord(action[at + 1], "type") ? at + 2 : isWord(action[at + 1], "set") && isWord(action[at + 2], "data") && isWord(action[at + 3], "type") ? at + 4 : -1;
      if (action[at] === undefined || typed < 0) continue;
      const column = nameText(action[at]!);
      const end = action.findIndex((token, j) => j >= typed && isWord(token, "using", "collate"));
      table.columns = table.columns.map((one) => (one.name === column ? { ...one, type: typeText(action.slice(typed, end < 0 ? action.length : end)) } : one));
    }
  }
}

/** The tables `files` (.sql, in the order given) leave, by name. */
function tablesOf(files: readonly File[]): StoreTable[] {
  const tables = new Map<string, Table>();
  for (const file of files) {
    const all = tokens(file.text);
    let start = 0;
    for (let i = 0; i <= all.length; i++) {
      if (i < all.length && !(all[i]!.kind === "punct" && all[i]!.text === ";")) continue;
      if (i > start) apply(all.slice(start, i), tables, file.path);
      start = i + 1;
    }
  }
  return [...tables.values()].sort((a, b) => byText(a.name, b.name)).map(({ name, columns, keys, from }) => ({
    name, columns, foreignKeys: keys.map(({ columns: own, table, references }) => ({ columns: own, table, references })), from,
  }));
}

// ---- Putting it together. ----

type Service = { readonly file: string; readonly name: string; readonly aliases: readonly string[]; readonly medium: StoreMedium; readonly image: string; readonly address: string; readonly ports: readonly string[]; readonly mounts: readonly string[] };

/** A compose service's published host ports. */
function publishedPorts(service: { readonly [key: string]: Yaml }): string[] {
  return listOf(service.ports).flatMap((entry) => {
    const published = textOf(mapOf(entry).published) ?? textOf(entry);
    if (published === undefined) return [];
    const parts = published.replace(/\/\w+$/, "").split(":");
    return parts.length >= 2 ? [parts.at(-2)!] : typeof entry === "object" && entry !== null ? [parts[0]!] : [];
  });
}

/** The repository folders a compose service mounts, from the compose file's folder. */
function mountedFolders(service: { readonly [key: string]: Yaml }, folder: string): string[] {
  return listOf(service.volumes).flatMap((entry) => {
    const source = textOf(mapOf(entry).source) ?? textOf(entry)?.split(":")[0];
    if (source === undefined || !source.startsWith(".")) return [];
    return [path.posix.normalize(path.posix.join(folder, source)).replace(/\/$/, "")];
  });
}

/**
 * The shared stores `files` (a repository's files, paths from its top with forward slashes) declare, by address: from
 * its compose files and committed connection settings, with each SQL store's tables from its .sql migrations.
 */
export function storesOf(files: readonly File[]): SharedStore[] {
  const stores = new Map<string, { medium: StoreMedium; evidence: StoreEvidence[] }>();
  const add = (address: string, medium: StoreMedium, evidence: StoreEvidence) => {
    const store = stores.get(address) ?? { medium, evidence: [] };
    if (!store.evidence.some((one) => one.file === evidence.file && one.says === evidence.says)) store.evidence.push(evidence);
    stores.set(address, store);
  };
  const addressOf = ({ medium, host, database }: Connection) => `${medium}://${host}${database === undefined ? "" : `/${database}`}`;
  const sorted = [...files].sort((a, b) => byPath(a.path, b.path));
  const nameOf = (file: File) => file.path.slice(file.path.lastIndexOf("/") + 1);

  const services: Service[] = [];
  const connections: { connection: Connection; evidence: StoreEvidence; composeFile?: string }[] = [];
  for (const file of sorted.filter((one) => COMPOSE.test(nameOf(one)))) {
    const folder = path.posix.dirname(file.path) === "." ? "" : path.posix.dirname(file.path);
    const variables = dotenv(files.find((one) => one.path === path.posix.join(folder, ".env"))?.text ?? "");
    for (const [name, value] of Object.entries(mapOf(mapOf(yaml(file.text)).services))) {
      const service = mapOf(value);
      const environment = new Map(environmentOf(service).map(([key, text]) => [key, interpolate(text, variables)] as const));
      const image = textOf(service.image);
      const repository = image?.replace(/[@].*$/, "").replace(/:[^/:]*$/, "").split("/").at(-1)?.toLowerCase();
      const medium = repository === undefined ? undefined : IMAGES.find(([pattern]) => pattern.test(repository))?.[1];
      if (image !== undefined && medium !== undefined) {
        const database = medium === "postgres" ? environment.get("POSTGRES_DB") || environment.get("POSTGRES_USER") || "postgres"
          : medium === "mysql" ? environment.get("MYSQL_DATABASE") || environment.get("MARIADB_DATABASE")
          : medium === "mongodb" ? environment.get("MONGO_INITDB_DATABASE") : undefined;
        const host = name.toLowerCase();
        const address = addressOf({ medium, host, ...(database === undefined || /[${}]/.test(database) ? {} : { database }) });
        const aliases = [host, textOf(service.hostname), textOf(service.container_name)].flatMap((alias) => (alias === undefined ? [] : [alias.toLowerCase()]));
        services.push({ file: file.path, name, aliases, medium, image, address, ports: publishedPorts(service), mounts: mountedFolders(service, folder) });
        add(address, medium, { file: file.path, says: `service ${name} (image ${image})` });
      }
      for (const [key, text] of environment) {
        for (const { connection } of connectionsIn(text)) connections.push({ connection, evidence: { file: file.path, says: `service ${name}: ${key}` }, composeFile: file.path });
      }
    }
  }
  for (const file of sorted.filter((one) => CONFIG.test(nameOf(one)) && !COMPOSE.test(nameOf(one)))) {
    for (const { connection, name } of connectionsIn(file.text)) connections.push({ connection, evidence: { file: file.path, says: name ?? "a connection string" } });
  }

  for (const { connection, evidence } of connections) {
    const named = services.find((service) => service.medium === connection.medium && service.aliases.includes(connection.host));
    const local = LOCAL.has(connection.host)
      ? services.filter((service) => service.medium === connection.medium && service.ports.includes(connection.port ?? DEFAULT_PORTS[connection.medium]))
      : [];
    const service = named ?? (local.length === 1 ? local[0] : undefined);
    add(service?.address ?? addressOf(connection), connection.medium, evidence);
  }

  const sqlStores = [...stores].filter(([, { medium }]) => SQL_MEDIA.has(medium)).map(([address]) => address);
  const migrations = new Map<string, File[]>();
  for (const file of sorted.filter((one) => SQL.test(one.path) && !DOWN.test(one.path))) {
    const mounting = services.filter((service) => SQL_MEDIA.has(service.medium) && service.mounts.some((mount) => file.path === mount || file.path.startsWith(`${mount}/`)));
    const address = mounting.length === 1 ? mounting[0]!.address : mounting.length === 0 && sqlStores.length === 1 ? sqlStores[0] : undefined;
    if (address !== undefined) migrations.set(address, [...(migrations.get(address) ?? []), file]);
  }

  const byFile = (a: StoreEvidence, b: StoreEvidence) => byPath(a.file, b.file);
  return [...stores].sort(([a], [b]) => byText(a, b)).map(([address, { medium, evidence }]) => ({
    address, medium, evidence: [...evidence].sort(byFile), tables: SQL_MEDIA.has(medium) ? tablesOf(migrations.get(address) ?? []) : [],
  }));
}
