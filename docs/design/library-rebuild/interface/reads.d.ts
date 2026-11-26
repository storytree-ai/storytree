import { Pool, PoolClient } from 'pg';

export interface ReadTotal {
	readonly reader: string;
	readonly bytes: number;
	readonly statements: number;
}
export declare function scriptReader(argv: readonly string[]): string;
export declare function nameReader(name: string): void;
export declare function processReaderName(): string;
export declare function asReader<T>(name: string, call: () => T): T;
export declare function readerName(): string;
export declare function takeReads(): ReadTotal[];
export declare function giveBackReads(totals: readonly ReadTotal[]): void;
export declare function atEnd(pool: Pool, last: () => Promise<unknown>): void;
export declare function lastWordsOf(pool: Pool): (() => Promise<unknown>) | undefined;
export declare function countReads(client: PoolClient): void;

export {};
