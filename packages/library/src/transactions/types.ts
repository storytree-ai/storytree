/**
 * Capability 2 · Library transactions (the library story): the only data actions the library
 * allows. A record is saved, fetched, listed by type, edited field by field, or retired with a
 * reason. Every change is all-or-nothing and is written first to an append-only history, so
 * nothing is ever truly erased.
 */

/** A stored record: its fields, and the envelope the library keeps around them. */
export interface RecordEnvelope {
  id: string;
  type: string;
  /** The schema version the record was written on: 1 unless the writer said otherwise. Stored as given, never interpreted here. */
  version: number;
  fields: Record<string, unknown>;
  /** When the record was first saved, as an ISO 8601 timestamp. */
  createdAt: string;
  /** When it last changed, as an ISO 8601 timestamp. */
  updatedAt: string;
}

/** One change, as the history keeps it. */
export interface HistoryEntry {
  /** Where the change sits in the project's history: strictly increasing, not necessarily contiguous. */
  seq: number;
  recordId: string;
  type: string;
  action: "created" | "updated" | "retired";
  /** The record after the change; for `retired`, its last state. */
  record: RecordEnvelope;
  /** Why the record was retired, or, when its writer said, why it changed. */
  reason?: string;
  /** Who made the change, when the writer said. */
  actor?: string;
  /** When the change was written, as an ISO 8601 timestamp. */
  at: string;
}

/**
 * Runs on the would-be record inside the write, after any merge. If it throws, the write aborts,
 * rejects with that error, and writes nothing: no record change and no history entry.
 */
export type Validate = (candidate: RecordEnvelope) => void;

export interface SaveInput {
  /** Abort before the write starts; ignored after it takes the write lock. */
  readonly signal?: AbortSignal;
  readonly id: string;
  readonly type: string;
  readonly fields: Record<string, unknown>;
  /** Defaults to 1. */
  readonly version?: number;
  readonly actor?: string;
  readonly validate?: Validate;
  /**
   * A field holding the record's number within its type (capability 13's decision numbers). When
   * the fields leave it out, the save stamps it with one more than the highest number any record
   * of the type has ever held, retired ones included; when they give one, no other record of the
   * type may ever have held it (NumberTakenError). Worked out inside the write, so writers at the
   * same time, on any connection, never get the same number.
   */
  readonly sequence?: string;
  /** Minimum for automatic allocation; explicit numbers are still checked only for collisions. */
  readonly sequenceFloor?: number;
  /** Refuse an id ever written, including retired records, under the project write lock. Health history does not count. */
  readonly onlyIfNew?: boolean;
  /** N1 repair: reserve all non-health history, including this record's and legacy types'. */
  readonly sequenceNeverHeld?: boolean;
}

export interface EditInput {
  /** Abort before the write starts; ignored after it takes the write lock. */
  readonly signal?: AbortSignal;
  /** Check the merged record's number against history inside the write, as save does. */
  readonly sequence?: string;
  /** N1 repair: check all non-health history, including this record's, under the write lock. */
  readonly sequenceNeverHeld?: boolean;
  readonly id: string;
  /** Merged shallowly onto the stored fields; a key whose value is `undefined` is removed. */
  readonly fields: Record<string, unknown>;
  readonly actor?: string;
  /** Why the record changed, kept in its history entry, when the writer says. */
  readonly reason?: string;
  /**
   * Runs on the stored record inside the write, before the merge, and returns the record to merge
   * onto: how a record written on an older schema version is upgraded in place. If it throws, the
   * write aborts and writes nothing, as for `validate`.
   */
  readonly upgrade?: Upgrade;
  readonly validate?: Validate;
}

/** The record to merge an edit onto, given the record stored now. */
export type Upgrade = (current: RecordEnvelope) => RecordEnvelope;

export interface RetireInput {
  /** Abort before the write starts; ignored after it takes the write lock. */
  readonly signal?: AbortSignal;
  readonly id: string;
  readonly reason: string;
  readonly actor?: string;
}

export interface HistoryFilter {
  /** Only this record's changes. */
  readonly id?: string;
  /** Only changes with a sequence number greater than this. */
  readonly since?: number;
  /** Only changes made at or after this time (an ISO 8601 time, in any zone), to the millisecond. */
  readonly from?: string;
  /** Only changes to records of these types; none for an empty list. */
  readonly types?: readonly string[];
  /** Only the first this many changes the rest of the filter keeps. Not with `newest`. */
  readonly oldest?: number;
  /** Only the last this many changes the rest of the filter keeps, still oldest first. Not with `oldest`. */
  readonly newest?: number;
}

/** Narrow current records before they leave the store. Predicates read STORED fields, before upgrades. */
export interface ListFilter {
  /** Only ids after this one, in the same byte order as the returned records. */
  readonly after?: string;
  /** Exact, case-sensitive substring in any selected stored top-level string field; omitted fields means all. */
  readonly phrase?: { readonly text: string; readonly fields?: readonly string[] };
  /** Only these ids; an empty list keeps none. */
  readonly ids?: readonly string[];
  /** Each dot-separated field path must equal the given JSON scalar; missing is different from null. */
  readonly where?: Readonly<Record<string, string | number | boolean | null>>;
  /** Each path must differ from the scalar; a missing path differs from every scalar. */
  readonly not?: Readonly<Record<string, string | number | boolean | null>>;
  /** Keep the first this many matches, in id order. */
  readonly limit?: number;
  /** Keep only these top-level fields on this version. Other versions stay whole for upgrade or refusal. */
  readonly projection?: { readonly version: number; readonly fields: readonly string[] };
}

/** A project's records. These six verbs are the only data actions the library allows. */
export interface Transactions {
  /** Create the record, or replace it whole if the id exists. Appends one history entry. */
  save(input: SaveInput): Promise<RecordEnvelope>;
  /** The current record, or `null` if it is missing or retired. */
  get(id: string): Promise<RecordEnvelope | null>;
  /** The current (not retired) records of one type, ordered by id. */
  list(type: string | readonly string[], filter?: ListFilter): Promise<RecordEnvelope[]>;
  /**
   * Change only the named fields, merged onto what is stored now. Returns `null`, and writes
   * nothing, if the record is missing or retired.
   */
  edit(input: EditInput): Promise<RecordEnvelope | null>;
  /** Retire the record: gone from `get` and `list`, kept in history. A no-op if it is missing or already retired. */
  retire(input: RetireInput): Promise<void>;
  /** The history, oldest first. */
  history(filter?: HistoryFilter): Promise<HistoryEntry[]>;
}
