export interface StoreOptions { readonly home?: string }
export interface ResolveOptions extends StoreOptions { readonly explicit?: string; readonly variable?: string; readonly env?: NodeJS.ProcessEnv }
export type KeySource = "file" | "command" | "environment";
export interface KeyReading { readonly name: string; readonly from: KeySource }
export function authFile(_options: StoreOptions = {}): string { throw new Error("not built"); }
export function saveKey(_name: string, _value: string, _options: StoreOptions = {}): void { throw new Error("not built"); }
export function removeKey(_name: string, _options: StoreOptions = {}): boolean { throw new Error("not built"); }
export function listKeys(_options: StoreOptions & { readonly env?: NodeJS.ProcessEnv } = {}): KeyReading[] { throw new Error("not built"); }
export function resolveKey(_name: string, _options: ResolveOptions = {}): string | undefined { throw new Error("not built"); }
