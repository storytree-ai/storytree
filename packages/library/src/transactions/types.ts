// Capability 2 · Library transactions

export interface RecordEnvelope {
  id: string;
  type: string;
  version: number;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  seq: number;
  recordId: string;
  type: string;
  action: "created" | "updated" | "retired";
  record: RecordEnvelope;
  reason?: string;
  actor?: string;
  outsideRead?: string[];
  at: string;
  recordedBy?: string;
}

export type OutsideRead = (type: string) => readonly string[] | undefined;

export type Validate = (candidate: RecordEnvelope) => void;

export interface SaveInput {
  readonly signal?: AbortSignal;
  readonly id: string;
  readonly type: string;
  readonly fields: Record<string, unknown>;
  readonly version?: number;
  readonly actor?: string;
  readonly outsideRead?: OutsideRead;
  readonly validate?: Validate;
  readonly sequence?: string;
  readonly sequenceFloor?: number;
  readonly onlyIfNew?: boolean;
  readonly sequenceNeverHeld?: boolean;
}

export interface EditInput {
  readonly signal?: AbortSignal;
  readonly sequence?: string;
  readonly sequenceNeverHeld?: boolean;
  readonly id: string;
  readonly fields: Record<string, unknown>;
  readonly actor?: string;
  readonly outsideRead?: OutsideRead;
  readonly reason?: string;
  readonly upgrade?: Upgrade;
  readonly validate?: Validate;
}

export type Upgrade = (current: RecordEnvelope) => RecordEnvelope;

export interface RetireInput {
  readonly signal?: AbortSignal;
  readonly id: string;
  readonly reason: string;
  readonly actor?: string;
  readonly outsideRead?: OutsideRead;
}

export interface RevertInput {
  readonly signal?: AbortSignal;
  readonly id: string;
  readonly to: number;
  readonly read: number;
  readonly actor?: string;
  readonly outsideRead?: OutsideRead;
  readonly reason?: string;
  readonly upgrade?: Upgrade;
  readonly validate?: Validate;
}

export interface RevertWritesInput {
  readonly signal?: AbortSignal;
  readonly of: string;
  readonly actor?: string;
  readonly reason?: string;
  readonly upgrade?: Upgrade;
  readonly validate?: Validate;
}

export interface RevertedWrite {
  readonly id: string;
  readonly action: "updated" | "retired";
  readonly to?: number;
}

export interface HistoryFilter {
  readonly id?: string;
  readonly since?: number;
  readonly actor?: string;
  readonly from?: string;
  readonly types?: readonly string[];
  readonly actions?: readonly HistoryEntry["action"][];
  readonly oldest?: number;
  readonly newest?: number;
  readonly upTo?: number;
  readonly healthColumns?: readonly string[];
  readonly fields?: readonly string[];
}

export interface ListFilter {
  readonly after?: string;
  readonly phrase?: { readonly text: string; readonly fields?: readonly string[] };
  readonly ids?: readonly string[];
  readonly where?: Readonly<Record<string, string | number | boolean | null>>;
  readonly not?: Readonly<Record<string, string | number | boolean | null>>;
  readonly limit?: number;
  readonly projection?: {
    readonly version: number;
    readonly fields: readonly string[];
    readonly older?: readonly { readonly version: number; readonly fields: readonly string[] }[];
  };
}

export interface Transactions {
  save(input: SaveInput): Promise<RecordEnvelope>;
  saveAll(inputs: readonly SaveInput[], signal?: AbortSignal): Promise<RecordEnvelope[]>;
  get(id: string): Promise<RecordEnvelope | null>;
  list(type: string | readonly string[], filter?: ListFilter): Promise<RecordEnvelope[]>;
  edit(input: EditInput): Promise<RecordEnvelope | null>;
  retire(input: RetireInput): Promise<void>;
  revert(input: RevertInput): Promise<RecordEnvelope>;
  revertWrites(input: RevertWritesInput): Promise<RevertedWrite[]>;
  history(filter?: HistoryFilter): Promise<HistoryEntry[]>;
  inOneWrite<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
