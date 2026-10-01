/**
 * Keys (ADR-0843): a key a user gives storytree once, saved in an owner-only `auth.json` in
 * storytree's home, and resolved the same way by every storytree process.
 */
export { authFile, listKeys, removeKey, resolveKey, saveKey, type KeyReading, type KeySource, type ResolveOptions, type StoreOptions } from "./keys.js";
