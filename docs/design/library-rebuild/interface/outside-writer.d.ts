import { ClientBase } from 'pg';

type ConnectOptions = ({
	readonly url: string;
	readonly connectTimeoutMs?: number;
	readonly address?: undefined;
} | {
	readonly address: string;
	readonly connectTimeoutMs?: number;
	readonly url?: undefined;
}) & {
	readonly statementTimeoutMs?: number;
	readonly waitMs?: number;
	readonly onWait?: (what: string) => void;
};
export interface OutsideWriter {
	readonly role: string;
	readonly kinds: readonly string[];
	readonly update?: boolean;
	readonly reads?: readonly string[];
}
export declare function fenceOutsideWriter(client: ClientBase, writer: OutsideWriter): Promise<void>;
export declare function fenceProject(options: ConnectOptions, project: string, writers: readonly OutsideWriter[]): Promise<void>;
export declare function outsideWriterSql(writer: OutsideWriter): string;

export {};
