import { Pool } from 'pg';
import { z } from 'zod';

interface RecordEnvelope {
	id: string;
	type: string;
	version: number;
	fields: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
interface HistoryEntry {
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
type OutsideRead = (type: string) => readonly string[] | undefined;
type Validate = (candidate: RecordEnvelope) => void;
interface SaveInput {
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
interface EditInput {
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
type Upgrade = (current: RecordEnvelope) => RecordEnvelope;
interface RetireInput {
	readonly signal?: AbortSignal;
	readonly id: string;
	readonly reason: string;
	readonly actor?: string;
	readonly outsideRead?: OutsideRead;
}
interface RevertInput {
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
interface RevertWritesInput {
	readonly signal?: AbortSignal;
	readonly of: string;
	readonly actor?: string;
	readonly reason?: string;
	readonly upgrade?: Upgrade;
	readonly validate?: Validate;
}
interface RevertedWrite {
	readonly id: string;
	readonly action: "updated" | "retired";
	readonly to?: number;
}
interface HistoryFilter {
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
interface ListFilter {
	readonly after?: string;
	readonly phrase?: {
		readonly text: string;
		readonly fields?: readonly string[];
	};
	readonly ids?: readonly string[];
	readonly names?: string;
	readonly where?: Readonly<Record<string, string | number | boolean | null>>;
	readonly not?: Readonly<Record<string, string | number | boolean | null>>;
	readonly limit?: number;
	readonly projection?: {
		readonly version: number;
		readonly fields: readonly string[];
		readonly older?: readonly {
			readonly version: number;
			readonly fields: readonly string[];
		}[];
	};
}
interface Transactions {
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
type RecordType = "arc" | "story" | "capability" | "contract" | "edge" | "health" | "decision" | "decisionNumbering" | "anchor" | "prCutover" | "definition" | KnowledgeKind | "increment" | "question" | "prediction" | "feedback" | "fyi" | "pin";
type KnowledgeKind = "principle" | "guardrail" | "pattern" | "process" | "agent" | "friction" | "resteer" | "techstack" | "check" | "research" | "experiment" | "escape" | "drill" | "measure";
declare const VERDICTS: readonly [
	"match",
	"match-with-changes",
	"different",
	"rejected"
];
declare const RECORD_SCHEMAS: {
	readonly decisionNumbering: z.ZodObject<{
		floor: z.ZodNumber;
	}, z.core.$strict>;
	readonly anchor: z.ZodObject<{
		what: z.ZodOptional<z.ZodString>;
		audience: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>;
	readonly prCutover: z.ZodObject<{
		at: z.ZodISODateTime;
		repository: z.ZodString;
		before: z.ZodNullable<z.ZodString>;
	}, z.core.$strict>;
	readonly arc: z.ZodObject<{
		title: z.ZodString;
		description: z.ZodOptional<z.ZodString>;
		stories: z.ZodOptional<z.ZodArray<z.ZodString>>;
		intent: z.ZodString;
		endState: z.ZodString;
		parked: z.ZodOptional<z.ZodLiteral<true>>;
		parkedUntil: z.ZodOptional<z.ZodString>;
		priority: z.ZodOptional<z.ZodNumber>;
		waits: z.ZodOptional<z.ZodArray<z.ZodObject<{
			on: z.ZodString;
			reason: z.ZodString;
		}, z.core.$strict>>>;
	}, z.core.$strict>;
	readonly story: z.ZodObject<{
		title: z.ZodString;
		description: z.ZodOptional<z.ZodString>;
		text: z.ZodOptional<z.ZodString>;
		mapped: z.ZodOptional<z.ZodObject<{
			from: z.ZodString;
			package: z.ZodString;
			folders: z.ZodArray<z.ZodString>;
		}, z.core.$strict>>;
		folders: z.ZodOptional<z.ZodArray<z.ZodString>>;
		plugin: z.ZodOptional<z.ZodString>;
		risk: z.ZodOptional<z.ZodObject<{
			depth: z.ZodObject<{
				value: z.ZodNumber;
				read: z.ZodString;
				reason: z.ZodString;
			}, z.core.$strict>;
			radius: z.ZodObject<{
				value: z.ZodNumber;
				downstream: z.ZodNumber;
				audience: z.ZodEnum<{
					owner: "owner";
					invited: "invited";
					public: "public";
				}>;
				users: z.ZodOptional<z.ZodNumber>;
				read: z.ZodString;
				reason: z.ZodString;
			}, z.core.$strict>;
		}, z.core.$strict>>;
		guardrails: z.ZodOptional<z.ZodArray<z.ZodObject<{
			check: z.ZodString;
			trigger: z.ZodEnum<{
				change: "change";
				release: "release";
			}>;
		}, z.core.$strict>>>;
	}, z.core.$strict>;
	readonly capability: z.ZodObject<{
		title: z.ZodString;
		story: z.ZodString;
		description: z.ZodOptional<z.ZodString>;
		text: z.ZodOptional<z.ZodString>;
		dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
		proposed: z.ZodBoolean;
		parent: z.ZodOptional<z.ZodString>;
		covers: z.ZodOptional<z.ZodArray<z.ZodString>>;
		storeLinks: z.ZodOptional<z.ZodArray<z.ZodObject<{
			store: z.ZodString;
			table: z.ZodString;
			direction: z.ZodEnum<{
				unknown: "unknown";
				read: "read";
				write: "write";
				both: "both";
			}>;
			cites: z.ZodArray<z.ZodString>;
		}, z.core.$strict>>>;
		guardrails: z.ZodOptional<z.ZodArray<z.ZodObject<{
			check: z.ZodString;
			trigger: z.ZodEnum<{
				change: "change";
				release: "release";
			}>;
		}, z.core.$strict>>>;
	}, z.core.$strict>;
	readonly edge: z.ZodObject<{
		from: z.ZodString;
		to: z.ZodString;
		description: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>;
	readonly contract: z.ZodObject<{
		title: z.ZodString;
		capability: z.ZodOptional<z.ZodString>;
		edge: z.ZodOptional<z.ZodString>;
		description: z.ZodOptional<z.ZodString>;
		provedBy: z.ZodOptional<z.ZodArray<z.ZodString>>;
		proof: z.ZodOptional<z.ZodUnion<readonly [
			z.ZodObject<{
				by: z.ZodEnum<{
					"test-criterion": "test-criterion";
					"agentic-user-acceptance-testing": "agentic-user-acceptance-testing";
				}>;
				reason: z.ZodString;
			}, z.core.$strict>,
			z.ZodObject<{
				by: z.ZodLiteral<"observability-as-proof">;
				reason: z.ZodString;
				freshness: z.ZodString;
				watcher: z.ZodString;
			}, z.core.$strict>
		]>>;
	}, z.core.$strict>;
	readonly health: z.ZodObject<{
		node: z.ZodString;
		column: z.ZodEnum<{
			reported: "reported";
			verified: "verified";
		}>;
		state: z.ZodEnum<{
			passing: "passing";
			failing: "failing";
			"not-checked": "not-checked";
		}>;
		by: z.ZodOptional<z.ZodString>;
		note: z.ZodOptional<z.ZodString>;
		skip: z.ZodOptional<z.ZodString>;
		was: z.ZodOptional<z.ZodEnum<{
			passing: "passing";
			failing: "failing";
		}>>;
		wasAt: z.ZodOptional<z.ZodString>;
		source: z.ZodOptional<z.ZodEnum<{
			local: "local";
			ci: "ci";
		}>>;
		tests: z.ZodOptional<z.ZodArray<z.ZodString>>;
		flaky: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly decision: z.ZodObject<{
		title: z.ZodString;
		text: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
		frontCoverOf: z.ZodOptional<z.ZodString>;
		status: z.ZodEnum<{
			proposed: "proposed";
			accepted: "accepted";
		}>;
		number: z.ZodOptional<z.ZodNumber>;
		supersedes: z.ZodOptional<z.ZodArray<z.ZodString>>;
		supersedesClauses: z.ZodOptional<z.ZodArray<z.ZodObject<{
			decision: z.ZodString;
			clauses: z.ZodOptional<z.ZodArray<z.ZodString>>;
		}, z.core.$strict>>>;
		narrows: z.ZodOptional<z.ZodArray<z.ZodString>>;
		justifications: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
		archivedLinks: z.ZodOptional<z.ZodArray<z.ZodObject<{
			to: z.ZodString;
			field: z.ZodEnum<{
				links: "links";
				supersedes: "supersedes";
				supersedesClauses: "supersedesClauses";
			}>;
			clauses: z.ZodOptional<z.ZodArray<z.ZodString>>;
			justification: z.ZodOptional<z.ZodString>;
			reason: z.ZodString;
			by: z.ZodString;
			at: z.ZodString;
		}, z.core.$strict>>>;
		loadBearing: z.ZodOptional<z.ZodBoolean>;
		decided: z.ZodOptional<z.ZodString>;
		authority: z.ZodOptional<z.ZodObject<{
			basis: z.ZodEnum<{
				"owner-directed": "owner-directed";
				"owner-ratified": "owner-ratified";
				"agent-derived": "agent-derived";
				"agent-flipped": "agent-flipped";
				"brought-across": "brought-across";
			}>;
			scribedBy: z.ZodString;
			at: z.ZodString;
			ownerSaid: z.ZodOptional<z.ZodString>;
			broughtFrom: z.ZodOptional<z.ZodObject<{
				record: z.ZodString;
				basis: z.ZodEnum<{
					"owner-directed": "owner-directed";
					"owner-ratified": "owner-ratified";
					"agent-derived": "agent-derived";
					"agent-flipped": "agent-flipped";
				}>;
			}, z.core.$strict>>;
		}, z.core.$strict>>;
		composed: z.ZodOptional<z.ZodObject<{
			statement: z.ZodString;
			composedAt: z.ZodString;
			fingerprint: z.ZodString;
		}, z.core.$strict>>;
	}, z.core.$strict>;
	readonly definition: z.ZodObject<{
		term: z.ZodString;
		meaning: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly principle: z.ZodObject<{
		statement: z.ZodString;
		why: z.ZodString;
		howToApply: z.ZodString;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly guardrail: z.ZodObject<{
		statement: z.ZodString;
		rule: z.ZodString;
		enforcedBy: z.ZodString;
		failureMode: z.ZodString;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly pattern: z.ZodObject<{
		statement: z.ZodString;
		problem: z.ZodString;
		approach: z.ZodString;
		tradeoffs: z.ZodOptional<z.ZodString>;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly process: z.ZodObject<{
		statement: z.ZodString;
		trigger: z.ZodString;
		steps: z.ZodString;
		surfaces: z.ZodString;
		failureModes: z.ZodString;
		verification: z.ZodOptional<z.ZodString>;
		branchEdges: z.ZodOptional<z.ZodArray<z.ZodObject<{
			to: z.ZodString;
			label: z.ZodOptional<z.ZodString>;
		}, z.core.$strict>>>;
		skill: z.ZodOptional<z.ZodString>;
		schedule: z.ZodOptional<z.ZodString>;
		timeZone: z.ZodOptional<z.ZodString>;
		precheck: z.ZodOptional<z.ZodEnum<{
			"feedback-waiting": "feedback-waiting";
			"questions-to-prep": "questions-to-prep";
		}>>;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly agent: z.ZodObject<{
		oneLine: z.ZodString;
		role: z.ZodString;
		outcome: z.ZodString;
		context: z.ZodArray<z.ZodString>;
		tools: z.ZodString;
		workflow: z.ZodString;
		rules: z.ZodOptional<z.ZodArray<z.ZodString>>;
		antiPatterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
		escalation: z.ZodOptional<z.ZodString>;
		stepRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
			step: z.ZodString;
			refs: z.ZodArray<z.ZodString>;
		}, z.core.$strict>>>;
		model: z.ZodOptional<z.ZodEnum<{
			inherit: "inherit";
			sonnet: "sonnet";
			opus: "opus";
		}>>;
		effort: z.ZodOptional<z.ZodEnum<{
			low: "low";
			medium: "medium";
			high: "high";
			xhigh: "xhigh";
		}>>;
		aliases: z.ZodOptional<z.ZodArray<z.ZodString>>;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly friction: z.ZodObject<{
		statement: z.ZodString;
		evidence: z.ZodString;
		impact: z.ZodString;
		state: z.ZodEnum<{
			open: "open";
			routed: "routed";
			resolved: "resolved";
			dismissed: "dismissed";
		}>;
		route: z.ZodOptional<z.ZodEnum<{
			principle: "principle";
			guardrail: "guardrail";
			process: "process";
			definition: "definition";
			nothing: "nothing";
			adr: "adr";
			tool: "tool";
			"edit-existing": "edit-existing";
		}>>;
		routeReason: z.ZodOptional<z.ZodString>;
		provenance: z.ZodOptional<z.ZodObject<{
			branch: z.ZodString;
			date: z.ZodString;
			source: z.ZodEnum<{
				retro: "retro";
				"run-analysis": "run-analysis";
			}>;
		}, z.core.$strict>>;
		reinforcedBy: z.ZodOptional<z.ZodArray<z.ZodObject<{
			branch: z.ZodString;
			date: z.ZodString;
			evidence: z.ZodString;
		}, z.core.$strict>>>;
		dischargedBy: z.ZodOptional<z.ZodString>;
		increment: z.ZodOptional<z.ZodString>;
		from: z.ZodOptional<z.ZodObject<{
			project: z.ZodString;
			increment: z.ZodOptional<z.ZodString>;
		}, z.core.$strict>>;
		lease: z.ZodOptional<z.ZodObject<{
			holder: z.ZodString;
			until: z.ZodString;
		}, z.core.$strict>>;
		lookup: z.ZodOptional<z.ZodUnion<readonly [
			z.ZodLiteral<"none">,
			z.ZodObject<{
				shown: z.ZodArray<z.ZodString>;
				noneMatch: z.ZodBoolean;
			}, z.core.$strict>
		]>>;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly resteer: z.ZodObject<{
		doing: z.ZodString;
		redirect: z.ZodString;
		evidence: z.ZodString;
		selfReport: z.ZodOptional<z.ZodString>;
		disposition: z.ZodEnum<{
			defect: "defect";
			taste: "taste";
		}>;
		dispositionBy: z.ZodEnum<{
			agent: "agent";
			owner: "owner";
		}>;
		mode: z.ZodOptional<z.ZodEnum<{
			"disobey-task-specification": "disobey-task-specification";
			"disobey-role-specification": "disobey-role-specification";
			"step-repetition": "step-repetition";
			"loss-of-conversation-history": "loss-of-conversation-history";
			"unaware-of-termination-conditions": "unaware-of-termination-conditions";
			"conversation-reset": "conversation-reset";
			"fail-to-ask-for-clarification": "fail-to-ask-for-clarification";
			"task-derailment": "task-derailment";
			"information-withholding": "information-withholding";
			"ignored-other-agents-input": "ignored-other-agents-input";
			"reasoning-action-mismatch": "reasoning-action-mismatch";
			"premature-termination": "premature-termination";
			"no-or-incomplete-verification": "no-or-incomplete-verification";
			"incorrect-verification": "incorrect-verification";
			"tool-defect": "tool-defect";
			"environment-defect": "environment-defect";
			"missing-capability": "missing-capability";
			"data-model-gap": "data-model-gap";
			"no-mast-home": "no-mast-home";
		}>>;
		provenance: z.ZodOptional<z.ZodObject<{
			branch: z.ZodString;
			date: z.ZodString;
			source: z.ZodEnum<{
				retro: "retro";
				"run-analysis": "run-analysis";
			}>;
		}, z.core.$strict>>;
		increment: z.ZodOptional<z.ZodString>;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly techstack: z.ZodObject<{
		statement: z.ZodString;
		whatItIs: z.ZodString;
		whyThis: z.ZodString;
		constraints: z.ZodOptional<z.ZodString>;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly check: z.ZodObject<{
		question: z.ZodString;
		enforces: z.ZodArray<z.ZodString>;
		howToAnswer: z.ZodOptional<z.ZodString>;
		examples: z.ZodOptional<z.ZodString>;
		graduated: z.ZodOptional<z.ZodArray<z.ZodObject<{
			part: z.ZodString;
			enforcedBy: z.ZodString;
			whole: z.ZodOptional<z.ZodLiteral<true>>;
			trial: z.ZodOptional<z.ZodString>;
			struck: z.ZodOptional<z.ZodString>;
			arc: z.ZodOptional<z.ZodString>;
		}, z.core.$strict>>>;
		projects: z.ZodOptional<z.ZodArray<z.ZodString>>;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly research: z.ZodObject<{
		researched: z.ZodString;
		findings: z.ZodString;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly experiment: z.ZodObject<{
		arms: z.ZodArray<z.ZodObject<{
			name: z.ZodString;
			description: z.ZodString;
			denies: z.ZodOptional<z.ZodObject<{
				tools: z.ZodArray<z.ZodString>;
				commands: z.ZodArray<z.ZodString>;
			}, z.core.$strict>>;
		}, z.core.$strict>>;
		hypotheses: z.ZodArray<z.ZodString>;
		measures: z.ZodArray<z.ZodString>;
		criteria: z.ZodObject<{
			helps: z.ZodString;
			noHelp: z.ZodString;
			inconclusive: z.ZodString;
		}, z.core.$strict>;
		budget: z.ZodString;
		stopRules: z.ZodArray<z.ZodString>;
		frozen: z.ZodOptional<z.ZodISODateTime>;
		outcome: z.ZodOptional<z.ZodString>;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly escape: z.ZodObject<{
		instance: z.ZodObject<{
			run: z.ZodOptional<z.ZodNumber>;
			pr: z.ZodOptional<z.ZodNumber>;
			head: z.ZodOptional<z.ZodString>;
			test: z.ZodOptional<z.ZodString>;
			contract: z.ZodOptional<z.ZodString>;
			story: z.ZodOptional<z.ZodString>;
			capability: z.ZodOptional<z.ZodString>;
			escape: z.ZodOptional<z.ZodString>;
		}, z.core.$strict>;
		caughtAt: z.ZodEnum<{
			escaped: "escaped";
			ci: "ci";
		}>;
		reasoning: z.ZodString;
		construct: z.ZodOptional<z.ZodString>;
		elsewhere: z.ZodOptional<z.ZodString>;
		generalises: z.ZodOptional<z.ZodEnum<{
			local: "local";
			yes: "yes";
			no: "no";
		}>>;
		generalisesWhy: z.ZodOptional<z.ZodString>;
		rung: z.ZodOptional<z.ZodEnum<{
			lint: "lint";
			none: "none";
			property: "property";
			"fault-injection": "fault-injection";
			"learned-break": "learned-break";
			"reviewer-check": "reviewer-check";
		}>>;
		rungWhy: z.ZodOptional<z.ZodString>;
		defences: z.ZodOptional<z.ZodArray<z.ZodString>>;
		plants: z.ZodOptional<z.ZodArray<z.ZodString>>;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly drill: z.ZodObject<{
		pattern: z.ZodString;
		plant: z.ZodObject<{
			story: z.ZodString;
			capability: z.ZodString;
			file: z.ZodString;
			shape: z.ZodString;
		}, z.core.$strict>;
		mode: z.ZodEnum<{
			defect: "defect";
			task: "task";
		}>;
		layers: z.ZodArray<z.ZodObject<{
			layer: z.ZodEnum<{
				"test-writer": "test-writer";
				builder: "builder";
				lint: "lint";
				tests: "tests";
				mutation: "mutation";
				"test-reviewer": "test-reviewer";
				"code-reviewer": "code-reviewer";
				"ci-linux": "ci-linux";
				"ci-windows": "ci-windows";
			}>;
			result: z.ZodEnum<{
				caught: "caught";
				missed: "missed";
				"not-run": "not-run";
			}>;
			evidence: z.ZodString;
		}, z.core.$strict>>;
		caughtBy: z.ZodEnum<{
			"test-writer": "test-writer";
			builder: "builder";
			lint: "lint";
			tests: "tests";
			mutation: "mutation";
			"test-reviewer": "test-reviewer";
			"code-reviewer": "code-reviewer";
			"ci-linux": "ci-linux";
			"ci-windows": "ci-windows";
			none: "none";
		}>;
		fixer: z.ZodEnum<{
			"test-writer": "test-writer";
			builder: "builder";
			"watcher-fix-session": "watcher-fix-session";
			escaped: "escaped";
		}>;
		sameModel: z.ZodOptional<z.ZodBoolean>;
		session: z.ZodString;
		date: z.ZodString;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly measure: z.ZodObject<{
		story: z.ZodString;
		base: z.ZodOptional<z.ZodBoolean>;
		reads: z.ZodString;
		unit: z.ZodString;
		better: z.ZodEnum<{
			higher: "higher";
			lower: "lower";
			neither: "neither";
		}>;
		howRead: z.ZodString;
		machine: z.ZodString;
		runs: z.ZodNumber;
		version: z.ZodNumber;
		title: z.ZodString;
		description: z.ZodString;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
	}, z.core.$strict>;
	readonly increment: z.ZodObject<{
		arc: z.ZodString;
		title: z.ZodString;
		objective: z.ZodString;
		body: z.ZodString;
		status: z.ZodEnum<{
			proposal: "proposal";
			active: "active";
			closed: "closed";
		}>;
		parked: z.ZodOptional<z.ZodString>;
		capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
		remedies: z.ZodOptional<z.ZodArray<z.ZodString>>;
		waits: z.ZodOptional<z.ZodArray<z.ZodObject<{
			on: z.ZodString;
			reason: z.ZodString;
		}, z.core.$strict>>>;
		waitsFor: z.ZodOptional<z.ZodArray<z.ZodObject<{
			releaser: z.ZodEnum<{
				owner: "owner";
				event: "event";
			}>;
			note: z.ZodString;
			checkBack: z.ZodOptional<z.ZodString>;
			why: z.ZodOptional<z.ZodString>;
			rank: z.ZodOptional<z.ZodNumber>;
			reviewed: z.ZodOptional<z.ZodUnion<readonly [
				z.ZodString,
				z.ZodISODateTime
			]>>;
			merged: z.ZodOptional<z.ZodNumber>;
		}, z.core.$strict>>>;
		heldOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
		machine: z.ZodOptional<z.ZodString>;
		pending: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [
			z.ZodObject<{
				before: z.ZodRecord<z.ZodString, z.ZodUnknown>;
				after: z.ZodRecord<z.ZodString, z.ZodUnknown>;
				record: z.ZodString;
				type: z.ZodEnum<{
					story: "story";
					capability: "capability";
					contract: "contract";
					edge: "edge";
				}>;
				base: z.ZodNumber;
			}, z.core.$strict>,
			z.ZodObject<{
				retire: z.ZodString;
				record: z.ZodString;
				type: z.ZodEnum<{
					story: "story";
					capability: "capability";
					contract: "contract";
					edge: "edge";
				}>;
				base: z.ZodNumber;
			}, z.core.$strict>
		]>>>;
		escape: z.ZodOptional<z.ZodUnion<readonly [
			z.ZodObject<{
				causedBy: z.ZodString;
				commit: z.ZodOptional<z.ZodString>;
				story: z.ZodString;
			}, z.core.$strict>,
			z.ZodLiteral<"none">
		]>>;
		risk: z.ZodOptional<z.ZodObject<{
			tier: z.ZodEnum<{
				low: "low";
				medium: "medium";
				high: "high";
			}>;
			rating: z.ZodNumber;
			depth: z.ZodNumber;
			radius: z.ZodNumber;
			flags: z.ZodArray<z.ZodString>;
			stories: z.ZodArray<z.ZodString>;
			read: z.ZodString;
		}, z.core.$strict>>;
		outcome: z.ZodOptional<z.ZodObject<{
			date: z.ZodString;
			pr: z.ZodOptional<z.ZodString>;
			note: z.ZodOptional<z.ZodString>;
			disposition: z.ZodEnum<{
				landed: "landed";
				failed: "failed";
				withdrawn: "withdrawn";
			}>;
		}, z.core.$strict>>;
	}, z.core.$strict>;
	readonly question: z.ZodObject<{
		arc: z.ZodString;
		title: z.ZodString;
		stakes: z.ZodString;
		statement: z.ZodString;
		context: z.ZodString;
		options: z.ZodString;
		analogy: z.ZodOptional<z.ZodString>;
		diagram: z.ZodOptional<z.ZodString>;
		recommendation: z.ZodOptional<z.ZodString>;
		links: z.ZodOptional<z.ZodArray<z.ZodString>>;
		unbuilt: z.ZodOptional<z.ZodArray<z.ZodString>>;
		lifecycle: z.ZodEnum<{
			open: "open";
			settled: "settled";
		}>;
		answer: z.ZodOptional<z.ZodString>;
		settledAt: z.ZodOptional<z.ZodString>;
		settledBy: z.ZodOptional<z.ZodString>;
		verifiedAt: z.ZodOptional<z.ZodString>;
		leaseDays: z.ZodOptional<z.ZodNumber>;
		presenting: z.ZodOptional<z.ZodObject<{
			session: z.ZodString;
			since: z.ZodString;
		}, z.core.$strict>>;
		prep: z.ZodOptional<z.ZodObject<{
			at: z.ZodString;
			stance: z.ZodEnum<{
				retire: "retire";
				agrees: "agrees";
				differs: "differs";
			}>;
			reason: z.ZodOptional<z.ZodString>;
			editedAt: z.ZodOptional<z.ZodString>;
		}, z.core.$strict>>;
		score: z.ZodOptional<z.ZodObject<{
			prediction: z.ZodOptional<z.ZodEnum<{
				match: "match";
				"match-with-changes": "match-with-changes";
				different: "different";
				rejected: "rejected";
			}>>;
			recommendation: z.ZodOptional<z.ZodEnum<{
				match: "match";
				"match-with-changes": "match-with-changes";
				different: "different";
				rejected: "rejected";
			}>>;
			by: z.ZodString;
			at: z.ZodString;
		}, z.core.$strict>>;
	}, z.core.$strict>;
	readonly prediction: z.ZodObject<{
		question: z.ZodString;
		pick: z.ZodUnion<readonly [
			z.ZodNumber,
			z.ZodEnum<{
				retire: "retire";
				defer: "defer";
			}>
		]>;
		confidence: z.ZodEnum<{
			low: "low";
			medium: "medium";
			high: "high";
		}>;
		why: z.ZodString;
		at: z.ZodString;
	}, z.core.$strict>;
	readonly feedback: z.ZodObject<{
		text: z.ZodString;
		surface: z.ZodString;
		story: z.ZodOptional<z.ZodString>;
		selection: z.ZodOptional<z.ZodString>;
		project: z.ZodOptional<z.ZodString>;
		version: z.ZodString;
		window: z.ZodObject<{
			width: z.ZodNumber;
			height: z.ZodNumber;
		}, z.core.$strict>;
		theme: z.ZodEnum<{
			light: "light";
			dark: "dark";
		}>;
		at: z.ZodString;
		anchor: z.ZodOptional<z.ZodObject<{
			selector: z.ZodString;
			tag: z.ZodString;
			role: z.ZodOptional<z.ZodString>;
			name: z.ZodOptional<z.ZodString>;
			text: z.ZodOptional<z.ZodString>;
			marks: z.ZodArray<z.ZodString>;
			components: z.ZodArray<z.ZodString>;
			box: z.ZodObject<{
				x: z.ZodNumber;
				y: z.ZodNumber;
				width: z.ZodNumber;
				height: z.ZodNumber;
			}, z.core.$strict>;
			styles: z.ZodRecord<z.ZodString, z.ZodString>;
			html: z.ZodString;
			drawn: z.ZodOptional<z.ZodObject<{
				kind: z.ZodEnum<{
					capability: "capability";
					gate: "gate";
					island: "island";
				}>;
				story: z.ZodString;
				capability: z.ZodOptional<z.ZodString>;
				between: z.ZodOptional<z.ZodTuple<[
					z.ZodString,
					z.ZodString
				], null>>;
				name: z.ZodString;
				box: z.ZodObject<{
					x: z.ZodNumber;
					y: z.ZodNumber;
					width: z.ZodNumber;
					height: z.ZodNumber;
				}, z.core.$strict>;
			}, z.core.$strict>>;
		}, z.core.$strict>>;
		status: z.ZodEnum<{
			routed: "routed";
			new: "new";
		}>;
		screenshot: z.ZodBoolean;
		crop: z.ZodOptional<z.ZodBoolean>;
		route: z.ZodOptional<z.ZodEnum<{
			increment: "increment";
			question: "question";
			closed: "closed";
		}>>;
		routedTo: z.ZodOptional<z.ZodString>;
		routeReason: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>;
	readonly fyi: z.ZodObject<{
		title: z.ZodString;
		what: z.ZodString;
		at: z.ZodString;
		about: z.ZodString;
		by: z.ZodString;
		heardAt: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>;
	readonly pin: z.ZodObject<{
		anchor: z.ZodUnion<readonly [
			z.ZodObject<{
				capability: z.ZodString;
				part: z.ZodOptional<z.ZodString>;
				name: z.ZodOptional<z.ZodString>;
			}, z.core.$strict>,
			z.ZodObject<{
				store: z.ZodString;
				table: z.ZodOptional<z.ZodString>;
			}, z.core.$strict>
		]>;
		icon: z.ZodEnum<{
			store: "store";
			cache: "cache";
			queue: "queue";
			api: "api";
			auth: "auth";
			config: "config";
			job: "job";
			events: "events";
			search: "search";
			logging: "logging";
			flag: "flag";
		}>;
		label: z.ZodString;
		evidence: z.ZodString;
		commit: z.ZodString;
		at: z.ZodString;
	}, z.core.$strict>;
};
type FieldsOf<T extends RecordType> = z.infer<(typeof RECORD_SCHEMAS)[T]>;
interface UpgradeStep {
	readonly type: string;
	readonly from: number;
	readonly name: string;
	readonly reads?: readonly string[];
	up(fields: Record<string, unknown>): Record<string, unknown>;
}
interface LibrarySchema {
	readonly versions: Readonly<Record<string, number>>;
	readonly schemas: Readonly<Record<string, z.ZodType>>;
	readonly upgrades: readonly UpgradeStep[];
}
type SchemaRecord<T extends RecordType = RecordType> = {
	[K in T]: Omit<RecordEnvelope, "type" | "fields"> & {
		type: K;
		fields: FieldsOf<K>;
		dormant?: true;
	};
}[T];
type FieldEdit = {
	[K in RecordType]: {
		[F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined;
	};
}[RecordType];
interface CreateOptions extends WriteOptions {
	readonly id?: string;
	readonly sequence?: string;
	readonly sequenceFloor?: number;
	readonly sequenceNeverHeld?: boolean;
	readonly onlyIfNew?: boolean;
}
interface WriteOptions {
	readonly actor?: string;
	readonly signal?: AbortSignal;
	readonly outsideRead?: () => Promise<readonly string[]>;
}
interface WriterChange {
	readonly id: string;
	readonly type: string;
	readonly writes: number;
	readonly before: SchemaRecord | null;
	readonly after: SchemaRecord | null;
	readonly retired?: string;
	readonly later?: {
		readonly seq: number;
		readonly actor?: string;
	};
}
declare class SchemaRecords {
	#private;
	constructor(transactions: Transactions, schema?: LibrarySchema);
	create<T extends RecordType>(type: T, fields: FieldsOf<T>, options?: CreateOptions): Promise<SchemaRecord<T>>;
	createAll<T extends RecordType>(records: readonly {
		type: T;
		fields: FieldsOf<T>;
		options?: Omit<CreateOptions, "sequence" | "sequenceFloor" | "sequenceNeverHeld" | "onlyIfNew" | "signal">;
	}[], signal?: AbortSignal): Promise<SchemaRecord<T>[]>;
	get(id: string): Promise<SchemaRecord | null>;
	list<T extends RecordType>(type: T | readonly T[], filter?: Omit<ListFilter, "projection">): Promise<SchemaRecord<T>[]>;
	select<T extends RecordType, K extends keyof FieldsOf<T> & string>(type: T, fields: readonly K[], filter?: Omit<ListFilter, "projection">): Promise<(Omit<SchemaRecord<T>, "fields"> & {
		fields: Pick<FieldsOf<T>, K>;
	})[]>;
	edit(id: string, fields: FieldEdit, options?: WriteOptions & {
		sequence?: string;
		sequenceNeverHeld?: boolean;
		reason?: string;
		checkCurrent?: (record: SchemaRecord) => void;
	}): Promise<SchemaRecord | null>;
	check(type: RecordType, fields: Record<string, unknown>): void;
	retire(id: string, reason: string, options?: WriteOptions): Promise<void>;
	revert(id: string, to: number, read: number, options?: WriteOptions & {
		reason?: string;
	}): Promise<SchemaRecord>;
	revertWrites(of: string, options?: WriteOptions & {
		reason?: string;
	}): Promise<RevertedWrite[]>;
	writtenBy(of: string): Promise<WriterChange[]>;
	history(filter?: HistoryFilter): Promise<HistoryEntry[]>;
	readonly current: (record: RecordEnvelope) => SchemaRecord;
	isDormant(type: string): boolean;
}
interface PluginUpgradeStep {
	readonly from: number;
	readonly name: string;
	readonly rename?: Readonly<Record<string, string>>;
	readonly remove?: readonly string[];
	readonly set?: Readonly<Record<string, unknown>>;
}
interface PluginRecordKind {
	readonly kind: string;
	readonly version: number;
	readonly fields: Readonly<Record<string, unknown>>;
	readonly upgrades?: readonly PluginUpgradeStep[];
	readonly writers: readonly string[];
}
declare const NEW_LINE: z.ZodDiscriminatedUnion<[
	z.ZodObject<{
		kind: z.ZodLiteral<"session-started">;
		how: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"session-ended">;
		reason: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"subagent-started">;
		subagent: z.ZodString;
		type: z.ZodOptional<z.ZodString>;
		task: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"subagent-ended">;
		subagent: z.ZodString;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"file-edited">;
		files: z.ZodArray<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"command-started">;
		command: z.ZodString;
		call: z.ZodString;
		limitMs: z.ZodOptional<z.ZodNumber>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"command-run">;
		command: z.ZodString;
		call: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"prompt-submitted">;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"turn-ended">;
		background: z.ZodOptional<z.ZodNumber>;
		exits: z.ZodOptional<z.ZodLiteral<true>>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"closed-out">;
		safe: z.ZodBoolean;
		why: z.ZodString;
		running: z.ZodOptional<z.ZodNumber>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"session-named">;
		title: z.ZodString;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"pointed">;
		capability: z.ZodOptional<z.ZodString>;
		gate: z.ZodOptional<z.ZodString>;
		why: z.ZodOptional<z.ZodString>;
		question: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"tool-requested">;
		tool: z.ZodString;
		call: z.ZodString;
		agent: z.ZodUnion<readonly [
			z.ZodLiteral<"orchestrator">,
			z.ZodLiteral<"unknown">,
			z.ZodObject<{
				subagent: z.ZodString;
				type: z.ZodOptional<z.ZodString>;
				task: z.ZodOptional<z.ZodString>;
			}, z.core.$strict>
		]>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"tool-called">;
		tool: z.ZodString;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"door-answered">;
		door: z.ZodEnum<{
			tool: "tool";
			command: "command";
		}>;
		verb: z.ZodString;
		outcome: z.ZodEnum<{
			refused: "refused";
			unknown: "unknown";
			failed: "failed";
			answered: "answered";
			"denied-by-arm": "denied-by-arm";
		}>;
		word: z.ZodOptional<z.ZodString>;
		named: z.ZodOptional<z.ZodString>;
		class: z.ZodOptional<z.ZodString>;
		next: z.ZodArray<z.ZodString>;
		pointedFrom: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"door-pointer">;
		where: z.ZodString;
		word: z.ZodString;
		to: z.ZodOptional<z.ZodString>;
		others: z.ZodArray<z.ZodString>;
		evidence: z.ZodString;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"door-checked">;
		since: z.ZodString;
		until: z.ZodString;
		filed: z.ZodArray<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"door-mounted">;
		verbs: z.ZodArray<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"process-ran">;
		process: z.ZodString;
		outcome: z.ZodEnum<{
			missed: "missed";
			failed: "failed";
			ok: "ok";
			concern: "concern";
			skipped: "skipped";
		}>;
		note: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		note: z.ZodString;
		found: z.ZodEnum<{
			search: "search";
			link: "link";
			id: "id";
			shelf: "shelf";
		}>;
		read: z.ZodEnum<{
			whole: "whole";
			peek: "peek";
		}>;
		agent: z.ZodOptional<z.ZodUnion<readonly [
			z.ZodLiteral<"orchestrator">,
			z.ZodLiteral<"unknown">,
			z.ZodObject<{
				subagent: z.ZodString;
				type: z.ZodOptional<z.ZodString>;
				task: z.ZodOptional<z.ZodString>;
			}, z.core.$strict>
		]>>;
		kind: z.ZodLiteral<"note-read">;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"outside-text-read">;
		what: z.ZodString;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		reason: z.ZodString;
		takenOverFrom: z.ZodOptional<z.ZodString>;
		quietSince: z.ZodOptional<z.ZodString>;
		takenBecause: z.ZodOptional<z.ZodEnum<{
			idle: "idle";
			gone: "gone";
			restart: "restart";
			"closed-out": "closed-out";
			stopped: "stopped";
		}>>;
		file: z.ZodOptional<z.ZodString>;
		under: z.ZodOptional<z.ZodString>;
		capability: z.ZodOptional<z.ZodString>;
		increment: z.ZodOptional<z.ZodString>;
		kind: z.ZodLiteral<"claimed">;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		holder: z.ZodString;
		reason: z.ZodString;
		file: z.ZodOptional<z.ZodString>;
		under: z.ZodOptional<z.ZodString>;
		capability: z.ZodOptional<z.ZodString>;
		increment: z.ZodOptional<z.ZodString>;
		kind: z.ZodLiteral<"claim-refused">;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		holder: z.ZodOptional<z.ZodString>;
		reason: z.ZodOptional<z.ZodString>;
		capability: z.ZodOptional<z.ZodString>;
		increment: z.ZodOptional<z.ZodString>;
		kind: z.ZodLiteral<"released">;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"user-allowed">;
		increment: z.ZodString;
		how: z.ZodEnum<{
			command: "command";
			prompt: "prompt";
			said: "said";
		}>;
		capabilities: z.ZodArray<z.ZodObject<{
			capability: z.ZodString;
			covers: z.ZodArray<z.ZodString>;
		}, z.core.$strict>>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"landed">;
		capability: z.ZodString;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"closed">;
		increment: z.ZodString;
		disposition: z.ZodEnum<{
			landed: "landed";
			failed: "failed";
			withdrawn: "withdrawn";
		}>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		holder: z.ZodString;
		branch: z.ZodString;
		pr: z.ZodNumber;
		capability: z.ZodOptional<z.ZodString>;
		increment: z.ZodOptional<z.ZodString>;
		kind: z.ZodLiteral<"merged">;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"pr-red">;
		pr: z.ZodNumber;
		increment: z.ZodString;
		conflict: z.ZodBoolean;
		checks: z.ZodArray<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"queue-red">;
		pr: z.ZodNumber;
		increment: z.ZodString;
		removedAt: z.ZodString;
		commit: z.ZodString;
		checks: z.ZodArray<z.ZodString>;
		tests: z.ZodArray<z.ZodString>;
		outcome: z.ZodEnum<{
			unknown: "unknown";
			real: "real";
			flake: "flake";
			ahead: "ahead";
		}>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"ci-rerun">;
		repo: z.ZodString;
		run: z.ZodNumber;
		attempt: z.ZodNumber;
		what: z.ZodEnum<{
			release: "release";
			pr: "pr";
			main: "main";
		}>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"lane-failed">;
		increment: z.ZodString;
		why: z.ZodString;
		logs: z.ZodArray<z.ZodString>;
		lane: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"lane-reoffered">;
		increment: z.ZodString;
		why: z.ZodString;
		by: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"branch-state">;
		of: z.ZodString;
		open: z.ZodBoolean;
		how: z.ZodEnum<{
			merged: "merged";
			ahead: "ahead";
			"not-ahead": "not-ahead";
			deleted: "deleted";
		}>;
		pr: z.ZodOptional<z.ZodNumber>;
		draft: z.ZodOptional<z.ZodLiteral<true>>;
		checks: z.ZodOptional<z.ZodEnum<{
			passing: "passing";
			failing: "failing";
			pending: "pending";
		}>>;
		queued: z.ZodOptional<z.ZodLiteral<true>>;
		checksSince: z.ZodOptional<z.ZodString>;
		queuedSince: z.ZodOptional<z.ZodString>;
		queueWaiting: z.ZodOptional<z.ZodLiteral<true>>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"main-state">;
		of: z.ZodString;
		dirty: z.ZodBoolean;
		unborn: z.ZodOptional<z.ZodLiteral<true>>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"session-archived">;
		of: z.ZodString;
		app: z.ZodEnum<{
			"claude-desktop": "claude-desktop";
			codex: "codex";
		}>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"session-unarchived">;
		of: z.ZodString;
		app: z.ZodEnum<{
			"claude-desktop": "claude-desktop";
			codex: "codex";
		}>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"machine-started">;
		machine: z.ZodString;
		startedAt: z.ZodString;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"session-described">;
		of: z.ZodString;
		app: z.ZodEnum<{
			"claude-desktop": "claude-desktop";
			codex: "codex";
		}>;
		title: z.ZodOptional<z.ZodString>;
		status: z.ZodOptional<z.ZodString>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"hook-times">;
		readings: z.ZodArray<z.ZodObject<{
			at: z.ZodString;
			harness: z.ZodString;
			event: z.ZodString;
			total: z.ZodNumber;
			parts: z.ZodObject<{
				startup: z.ZodOptional<z.ZodNumber>;
				connect: z.ZodOptional<z.ZodNumber>;
				write: z.ZodOptional<z.ZodNumber>;
				handoff: z.ZodOptional<z.ZodNumber>;
			}, z.core.$strict>;
		}, z.core.$strict>>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"usage-measured">;
		context: z.ZodObject<{
			tokens: z.ZodOptional<z.ZodNumber>;
			window: z.ZodNumber;
			percent: z.ZodOptional<z.ZodNumber>;
		}, z.core.$strict>;
		rateLimits: z.ZodArray<z.ZodObject<{
			kind: z.ZodString;
			percentUsed: z.ZodNumber;
			resetsAt: z.ZodOptional<z.ZodString>;
		}, z.core.$strict>>;
		cost: z.ZodOptional<z.ZodObject<{
			usd: z.ZodNumber;
		}, z.core.$strict>>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>,
	z.ZodObject<{
		kind: z.ZodLiteral<"turn-failed">;
		reason: z.ZodEnum<{
			error: "error";
			refusal: "refusal";
		}>;
		limits: z.ZodOptional<z.ZodArray<z.ZodString>>;
		session: z.ZodString;
		harness: z.ZodOptional<z.ZodString>;
		source: z.ZodEnum<{
			tool: "tool";
			hook: "hook";
		}>;
		folder: z.ZodOptional<z.ZodString>;
		branch: z.ZodOptional<z.ZodString>;
		machine: z.ZodOptional<z.ZodString>;
		transcript: z.ZodOptional<z.ZodString>;
		causedBy: z.ZodOptional<z.ZodNumber>;
		experiment: z.ZodOptional<z.ZodString>;
		arm: z.ZodOptional<z.ZodString>;
	}, z.core.$strict>
], "kind">;
type NewLine = z.infer<typeof NEW_LINE>;
type PrCutover = FieldsOf<"prCutover">;
type ContractProof = NonNullable<FieldsOf<"contract">["proof"]>;
type NewStory = Omit<FieldsOf<"story">, "mapped" | "plugin">;
interface MappedPackage {
	readonly package: string;
	readonly title: string;
	readonly description?: string;
	readonly folders: readonly string[];
}
interface MappedStories {
	readonly added: SchemaRecord<"story">[];
	readonly retired: string[];
	readonly kept: string[];
}
interface PluginPlan {
	readonly story: {
		readonly title: string;
		readonly description?: string;
		readonly text?: string;
	};
	readonly capabilities: readonly PluginPlanCapability[];
}
interface PluginPlanCapability {
	readonly title: string;
	readonly description?: string;
	readonly text?: string;
	readonly proposed?: boolean;
	readonly dependsOn?: string[];
	readonly contracts: readonly {
		readonly title: string;
		readonly description?: string;
		readonly proof?: Readonly<ContractProof>;
	}[];
}
interface ImportedPluginPlan {
	readonly story: string;
	readonly added: string[];
	readonly edited: string[];
	readonly retired: string[];
	readonly kept: string[];
	readonly left: string[];
	readonly stood: string[];
}
interface PluginPlanHeld {
	readonly capabilities: readonly number[];
	readonly contracts: readonly string[];
	readonly versions?: readonly unknown[];
}
type NewCapability = Omit<FieldsOf<"capability">, "proposed"> & {
	proposed?: boolean;
};
type NewContract = FieldsOf<"contract">;
type NewEdge = FieldsOf<"edge">;
type EdgeEdit = {
	description?: string | undefined;
};
interface MovedToEdges {
	readonly edges: string[];
	readonly capabilities: string[];
}
type CapabilityEdit = {
	[F in keyof FieldsOf<"capability">]?: FieldsOf<"capability">[F] | undefined;
};
type StoryEdit = {
	[F in keyof NewStory]?: NewStory[F] | undefined;
};
type ContractEdit = {
	[F in keyof FieldsOf<"contract">]?: FieldsOf<"contract">[F] | undefined;
};
interface ContractWriteOptions extends WriteOptions {
	readonly testedNumbers?: readonly string[];
}
type PendingPlanChange = NonNullable<FieldsOf<"increment">["pending"]>[number];
interface CapabilityWriteOptions extends WriteOptions {
	readonly pending?: readonly PendingPlanChange[];
	readonly levels?: readonly string[];
}
type Anchor = FieldsOf<"anchor">;
type AnchorEdit = {
	[F in keyof Anchor]?: Anchor[F] | undefined;
};
interface ProjectTree {
	anchor?: Anchor;
	stories: StoryNode[];
	arcs: ArcNode[];
}
type Guardrail = NonNullable<FieldsOf<"story">["guardrails"]>[number];
type StoreLink = NonNullable<FieldsOf<"capability">["storeLinks"]>[number];
interface StoryNode {
	id: string;
	title: string;
	description?: string;
	mapped?: {
		from: string;
		package: string;
		folders: string[];
	};
	folders?: string[];
	plugin?: string;
	risk?: NonNullable<FieldsOf<"story">["risk"]>;
	guardrails?: Guardrail[];
	capabilities: CapabilityNode[];
	edges?: EdgeNode[];
}
interface EdgeNode {
	id: string;
	from: string;
	to: string;
	description?: string;
	contracts: ContractNode[];
}
interface CapabilityNode {
	id: string;
	title: string;
	description?: string;
	dependsOn: string[];
	proposed: boolean;
	parent?: string;
	covers?: string[];
	storeLinks?: StoreLink[];
	guardrails?: Guardrail[];
	contracts: ContractNode[];
}
interface ContractNode {
	id: string;
	title: string;
	description?: string;
	provedBy?: string[];
	proof?: ContractProof;
}
interface ArcNode {
	id: string;
	title: string;
	description?: string;
	stories: string[];
}
declare class WorkModel {
	#private;
	constructor(records: SchemaRecords);
	addStory(story: NewStory, options?: WriteOptions): Promise<SchemaRecord<"story">>;
	mapStories(from: string, packages: readonly MappedPackage[], options?: WriteOptions): Promise<MappedStories>;
	importPluginPlan(plugin: string, plan: PluginPlan, options?: WriteOptions & {
		adopt?: string;
		held?: PluginPlanHeld;
	}): Promise<ImportedPluginPlan>;
	addCapability(capability: NewCapability, options?: CapabilityWriteOptions): Promise<SchemaRecord<"capability">>;
	editCapability(id: string, fields: CapabilityEdit, options?: CapabilityWriteOptions): Promise<SchemaRecord<"capability"> | null>;
	setProposed(id: string, proposed: boolean, options?: WriteOptions): Promise<SchemaRecord<"capability"> | null>;
	addContract(contract: NewContract, options?: ContractWriteOptions): Promise<SchemaRecord<"contract">>;
	addEdge(edge: NewEdge, options?: WriteOptions): Promise<SchemaRecord<"edge">>;
	editEdge(id: string, fields: EdgeEdit, options?: WriteOptions): Promise<SchemaRecord<"edge"> | null>;
	dependsOn(id: string): Promise<string[] | null>;
	moveDependsOnToEdges(options?: WriteOptions): Promise<MovedToEdges>;
	editStory(id: string, fields: StoryEdit, options?: WriteOptions): Promise<SchemaRecord<"story"> | null>;
	editContract(id: string, fields: ContractEdit, options?: ContractWriteOptions): Promise<SchemaRecord<"contract"> | null>;
	projectTree(): Promise<ProjectTree>;
	anchor(): Promise<Anchor | undefined>;
	setAnchor(fields: AnchorEdit, options?: WriteOptions): Promise<SchemaRecord<"anchor">>;
	prCutover(): Promise<PrCutover | undefined>;
	setPrCutover(fields: Partial<PrCutover>, options?: WriteOptions): Promise<SchemaRecord<"prCutover">>;
	refusePluginEdit(record: SchemaRecord<"story"> | SchemaRecord<"capability"> | SchemaRecord<"contract"> | SchemaRecord<"edge">, fields: Readonly<Record<string, unknown>>): Promise<void>;
	refuseEdgeEnds(fields: Readonly<Record<string, unknown>>): void;
}
type PendingChange = NonNullable<FieldsOf<"increment">["pending"]>[number];
type PlanChange = {
	readonly record: string;
	readonly fields: Readonly<Record<string, unknown>>;
} | {
	readonly record: string;
	readonly retire: string;
};
type Pended = {
	readonly pending: PendingChange;
} | {
	readonly plannedHere: true;
};
interface StalePending {
	readonly record: string;
	readonly type: PendingChange["type"];
	readonly base: number;
	readonly moved: {
		readonly seq: number;
		readonly action: "created" | "updated" | "retired";
		readonly at: string;
		readonly actor?: string;
	};
}
type UnappliedPending = (StalePending & {
	readonly why: "stale";
}) | {
	readonly record: string;
	readonly type: PendingChange["type"];
	readonly base: number;
	readonly why: "refused";
	readonly refusal: string;
};
interface AppliedPending {
	readonly applied: string[];
	readonly residue?: {
		readonly increment: string;
		readonly changes: UnappliedPending[];
	};
}
interface SettledPending extends AppliedPending {
	readonly increment: string;
	readonly dropped: number;
}
type NewQuestion = Omit<FieldsOf<"question">, "lifecycle" | "answer" | "settledAt" | "settledBy" | "verifiedAt">;
interface QuestionEdit {
	readonly title?: string;
	readonly stakes?: string;
	readonly statement?: string;
	readonly context?: string;
	readonly options?: string;
	readonly analogy?: string | undefined;
	readonly diagram?: string | undefined;
	readonly recommendation?: string | undefined;
	readonly links?: readonly string[];
	readonly unbuilt?: readonly string[];
	readonly presenting?: {
		readonly session: string;
		readonly since: string;
	} | undefined;
}
interface Settlement {
	readonly answer: string;
	readonly decision?: string;
}
type WouldBeAnswer = Omit<FieldsOf<"prediction">, "question" | "at">;
type Verdict = (typeof VERDICTS)[number];
interface Score {
	readonly prediction?: Verdict;
	readonly recommendation?: Verdict;
	readonly by: string;
}
interface Prep {
	readonly stance: "agrees" | "differs" | "retire";
	readonly reason?: string;
}
interface DeviationBand {
	readonly band: "high" | "medium" | "low" | "none";
	readonly questions: number;
	readonly prediction?: Readonly<Record<Verdict, number>>;
	readonly recommendation: Readonly<Record<Verdict, number>>;
}
interface QuestionDeviation {
	readonly settled: number;
	readonly unscored: number;
	readonly bands: readonly DeviationBand[];
}
interface QuestionLease {
	readonly id: string;
	readonly state: "fresh" | "lapsed" | "settled";
	readonly verifiedAt?: string;
	readonly leaseDays: number;
	readonly lapsesAt?: string;
}
interface Hold {
	readonly on: string;
	readonly reason: string;
	readonly forGood: boolean;
	readonly claim?: true;
	readonly title?: string;
}
interface ClaimReading {
	readonly claimed?: ReadonlySet<string>;
}
type WaitFor = NonNullable<FieldsOf<"increment">["waitsFor"]>[number];
interface NoteWait {
	readonly releaser: WaitFor["releaser"];
	readonly note: string;
	readonly checkBack?: string;
	readonly why?: string;
	readonly rank?: number;
	readonly reviewed?: string;
	readonly merged?: number;
	readonly holds: boolean;
}
interface Holds {
	readonly waits: Readonly<Record<string, Hold[]>>;
	readonly heldOn: Readonly<Record<string, string[]>>;
	readonly waitsFor?: Readonly<Record<string, NoteWait[]>>;
}
type Wait = {
	readonly on: string;
	readonly reason: string;
};
type ClearOptions = WriteOptions & {
	readonly reason?: string;
};
type WaitWrite = Omit<WaitFor, "note" | "reviewed" | "merged"> & {
	readonly note?: string;
};
type SettledQuestion = SchemaRecord<"question"> & {
	released: {
		id: string;
		title: string;
	}[];
};
type ArcState = "active" | "parked" | "closed";
type Disposition = NonNullable<FieldsOf<"increment">["outcome"]>["disposition"];
interface CloseInput {
	readonly pr?: string;
	readonly note?: string;
	readonly disposition: Disposition;
	readonly date?: string;
}
interface NewIncrement {
	readonly arc: string;
	readonly title: string;
	readonly objective: string;
	readonly body: string;
	readonly capabilities?: string[];
	readonly links?: string[];
	readonly remedies?: string[];
	readonly heldOn?: string[];
	readonly machine?: string;
	readonly escape?: Escape;
	readonly waits?: Wait[];
	readonly waitsFor?: (WaitWrite & {
		readonly note: string;
	})[];
	readonly outcome?: CloseInput;
}
interface IncrementEdit {
	readonly title?: string;
	readonly objective?: string;
	readonly body?: string;
	readonly capabilities?: string[] | undefined;
	readonly links?: string[] | undefined;
	readonly remedies?: string[] | undefined;
	readonly heldOn?: string[] | undefined;
	readonly machine?: string | undefined;
	readonly escape?: Escape | undefined;
	readonly risk?: RiskLine | undefined;
}
type RiskLine = NonNullable<FieldsOf<"increment">["risk"]>;
type Escape = NonNullable<FieldsOf<"increment">["escape"]>;
type NewArc = Omit<FieldsOf<"arc">, "parked">;
type ArcEdit = {
	[F in keyof NewArc]?: NewArc[F] | undefined;
};
interface ParkedOn {
	readonly arc: string;
	readonly title: string;
}
interface ParkOptions extends WriteOptions {
	readonly until?: string;
}
interface ArcView {
	readonly arc: SchemaRecord<"arc">;
	readonly state: ArcState;
	readonly wakes?: string;
	readonly increments: SchemaRecord<"increment">[];
	readonly questions: SchemaRecord<"question">[];
}
declare const BOARD_INCREMENT_FIELDS: readonly [
	"arc",
	"title",
	"objective",
	"status",
	"parked",
	"capabilities",
	"links",
	"waits",
	"waitsFor",
	"heldOn",
	"outcome",
	"machine"
];
type BoardIncrement = Omit<SchemaRecord<"increment">, "fields"> & {
	fields: Pick<FieldsOf<"increment">, (typeof BOARD_INCREMENT_FIELDS)[number]>;
};
interface BoardArcView {
	readonly arc: SchemaRecord<"arc">;
	readonly state: ArcState;
	readonly wakes?: string;
	readonly closed?: string;
	readonly increments: BoardIncrement[];
	readonly questions: SchemaRecord<"question">[];
}
declare const SURVEY_INCREMENT_FIELDS: readonly [
	"arc",
	"title",
	"status",
	"parked",
	"capabilities",
	"machine",
	"waits",
	"waitsFor",
	"heldOn",
	"outcome"
];
type SurveyIncrement = Omit<SchemaRecord<"increment">, "fields"> & {
	fields: Pick<FieldsOf<"increment">, (typeof SURVEY_INCREMENT_FIELDS)[number]>;
};
interface SurveyArc {
	readonly id: string;
	readonly createdAt: string;
	readonly state: ArcState;
	readonly wakes?: string;
	readonly title?: string;
	readonly priority?: number;
	readonly openQuestions: number;
}
interface SurveyOptions {
	readonly also?: readonly string[];
	readonly closedTitles?: boolean;
	readonly empty?: (arcs: readonly string[]) => Promise<ReadonlySet<string>>;
}
interface WorkSurvey {
	readonly arcs: SurveyArc[];
	readonly increments: SurveyIncrement[];
	holds(reading?: ClaimReading): Holds;
}
interface DayWindow {
	readonly from: string;
	readonly to: string;
}
interface OpenListing {
	readonly increment: string;
	readonly title: string;
	readonly arc: string;
	readonly capabilities: readonly string[];
}
declare class WorkInFlight {
	#private;
	constructor(records: SchemaRecords, work?: WorkModel);
	addIncrement(increment: NewIncrement, options?: WriteOptions): Promise<SchemaRecord<"increment">>;
	openListing(capabilities: readonly string[], except?: string): Promise<OpenListing[]>;
	advanceIncrement(id: string, to: "active", options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
	returnIncrement(id: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
	closeIncrement(id: string, close: CloseInput, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
	correctIncrementClosure(id: string, close: CloseInput, reason: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
	moveIncrement(id: string, arc: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
	editIncrement(id: string, fields: IncrementEdit, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
	pendChange(id: string, change: PlanChange, options?: WriteOptions): Promise<Pended | null>;
	withPending(id: string, tree: ProjectTree): Promise<ProjectTree | null>;
	stalePending(id: string): Promise<StalePending[] | null>;
	applyPending(id: string, pr?: string, options?: WriteOptions): Promise<AppliedPending | null>;
	dropPending(id: string, record: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
	settleClosedPending(options?: WriteOptions): Promise<SettledPending[]>;
	addWait(waiter: string, blocker: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null>;
	removeWait(waiter: string, blocker: string, options?: ClearOptions): Promise<SchemaRecord<"arc" | "increment"> | null>;
	releaseOnVerdict(contract: string, capability: string | undefined, verdict: string, options?: WriteOptions, asOf?: number): Promise<string[]>;
	addWaitFor(id: string, wait: WaitWrite, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
	removeWaitFor(id: string, releaser: WaitFor["releaser"], options?: ClearOptions, cleared?: {
		readonly merged?: number;
	}): Promise<SchemaRecord<"increment"> | null>;
	waitsFor(id: string, at?: Date): Promise<NoteWait[]>;
	waitHolds(id: string, { claimed }?: ClaimReading): Promise<Hold[]>;
	holds(at?: Date, reading?: ClaimReading): Promise<Holds>;
	raiseQuestion(question: NewQuestion, options?: WriteOptions): Promise<SchemaRecord<"question">>;
	checkQuestion(id: string, at?: Date): Promise<QuestionLease | null>;
	renewQuestion(id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null>;
	editQuestion(id: string, fields: QuestionEdit, options?: WriteOptions): Promise<SchemaRecord<"question"> | null>;
	linkNamedEvidence(id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null>;
	moveQuestion(id: string, arc: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null>;
	predictQuestion(id: string, answer: WouldBeAnswer, options?: WriteOptions): Promise<SchemaRecord<"prediction"> | null>;
	questionPrediction(id: string): Promise<SchemaRecord<"prediction"> | null>;
	scoreQuestion(id: string, score: Score, options?: WriteOptions): Promise<SchemaRecord<"question"> | null>;
	prepQuestion(id: string, prep: Prep, options?: WriteOptions): Promise<SchemaRecord<"question"> | null>;
	questionDeviation(since: Date): Promise<QuestionDeviation>;
	lapsedQuestions(at?: Date): Promise<SchemaRecord<"question">[]>;
	settleQuestion(id: string, settlement: Settlement, options?: WriteOptions): Promise<SettledQuestion | null>;
	questions(arcId: string): Promise<SchemaRecord<"question">[]>;
	heldOnQuestion(incrementId: string): Promise<string[]>;
	retireQuestion(id: string, reason: string, options?: WriteOptions): Promise<string[] | null>;
	retire(id: string, reason: string, options?: WriteOptions): Promise<void>;
	createArc(arc: NewArc, options?: WriteOptions & {
		readonly id?: string;
		readonly onlyIfNew?: boolean;
	}): Promise<SchemaRecord<"arc">>;
	editArc(id: string, fields: ArcEdit, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null>;
	arcsFor(storyId: string): Promise<SchemaRecord<"arc">[]>;
	parkArc(id: string, options?: ParkOptions): Promise<SchemaRecord<"arc"> | null>;
	unparkArc(id: string, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null>;
	arcView(id: string, at?: Date): Promise<ArcView | null>;
	arcViews(at?: Date): Promise<ArcView[]>;
	workSurvey(at?: Date, { also, closedTitles, empty }?: SurveyOptions): Promise<WorkSurvey>;
	boardArcs(closed: DayWindow, at?: Date): Promise<BoardArcView[]>;
	closedArcs(window: DayWindow, at?: Date): Promise<BoardArcView[]>;
	parkedCapabilities(at?: Date): Promise<Map<string, ParkedOn[]>>;
}
type PlanEditors = Pick<SchemaRecords, "get"> & Pick<WorkModel, "editStory" | "editCapability" | "editContract" | "editEdge"> & Pick<WorkInFlight, "editArc" | "editIncrement" | "pendChange">;
interface PlanClaim {
	readonly session: string;
	readonly increment?: string | undefined;
	readonly capability?: string | undefined;
	readonly since: string;
	readonly branch?: string | undefined;
	readonly holder?: string | undefined;
}
type PlanRecordType = "story" | "capability" | "contract" | "edge" | "arc" | "increment";
type PlanEdit = {
	readonly held: string;
} | {
	readonly refused: string;
} | {
	readonly edited: SchemaRecord;
};
export declare function refuseHeldPlanWrite(library: Pick<SchemaRecords, "get">, claims: readonly PlanClaim[], session: string, id: string): Promise<string | undefined>;
export declare function holdPlanChange(library: PlanEditors, claims: readonly PlanClaim[], session: string, change: PlanChange, writer: WriteOptions): Promise<string | undefined>;
export declare function heldSaid(increment: string): string;
export declare function heldPending(library: PlanEditors, claims: readonly PlanClaim[], session: string): Promise<readonly PendingChange[]>;
export declare function editPlanRecord(library: PlanEditors, claims: readonly PlanClaim[], session: string, { type, id, fields, live }: {
	readonly type: PlanRecordType;
	readonly id: string;
	readonly fields: Record<string, unknown>;
	readonly live?: boolean;
}, writer: WriteOptions): Promise<PlanEdit | null>;
type HealthState = FieldsOf<"health">["state"];
type HealthColumnName = FieldsOf<"health">["column"];
interface HealthColumn {
	state: HealthState;
	by?: string;
	at?: string;
	note?: string;
	skip?: SkipKind;
	was?: EarlierVerdict;
	source?: HealthSource;
	tests?: string[];
	flaky?: string[];
}
type HealthSource = NonNullable<FieldsOf<"health">["source"]>;
type SkipKind = "owner" | "other" | `platform:${string}`;
interface EarlierVerdict {
	state: "passing" | "failing";
	at: string;
}
interface NodeHealth {
	reported: HealthColumn;
	verified: HealthColumn;
	ci?: HealthColumn;
}
interface HealthOptions extends WriteOptions {
	readonly by?: string;
	readonly note?: string;
	readonly skip?: SkipKind;
	readonly was?: EarlierVerdict;
	readonly source?: HealthSource;
	readonly tests?: readonly string[];
	readonly flaky?: readonly string[];
}
interface VerifiedVerdict {
	readonly contractId: string;
	readonly state: HealthState;
	readonly options?: HealthOptions;
}
interface ToldTurn {
	contract: string;
	title: string;
	at: string;
	released: string[];
	investigated?: string[];
}
interface FlakeSeen {
	readonly test: string;
	readonly story?: string;
	readonly of?: string;
	readonly contract?: string;
	readonly seen: string;
	readonly evidence: string;
	readonly found: string;
	readonly by: string;
	readonly at?: string;
}
interface HealthEntry {
	column: HealthColumnName;
	state: HealthState;
	by?: string;
	at: string;
	note?: string;
	skip?: SkipKind;
	was?: EarlierVerdict;
	source?: HealthSource;
	tests?: string[];
	flaky?: string[];
}
interface AnnotatedContract extends ContractNode {
	health: NodeHealth;
}
type CapabilityStatus = "proposed" | "healthy" | "unhealthy" | "untested";
interface AnnotatedCapability extends Omit<CapabilityNode, "contracts"> {
	contracts: AnnotatedContract[];
	health: NodeHealth;
	status: CapabilityStatus;
	why?: CapabilityWhy;
	unclaimed?: HealthColumn;
	reportOnly?: true;
	parkedOn?: ParkedOn[];
	openWork?: OpenIncrement[];
}
interface OpenIncrement {
	increment: string;
	title: string;
	active?: true;
	waits?: OpenWait[];
}
type OpenWait = {
	kind: "work";
	on: string;
	title: string;
	state?: "active" | "ready";
} | {
	kind: "claim";
	on: string;
	title: string;
} | {
	kind: "question";
	on: string;
} | {
	kind: "owner" | "event";
	note: string;
};
type HealthReason = "not built" | "failing" | "not re-run" | "no test names it" | "no live reading" | "acceptance test not run" | "out of CI's reach" | "needs owner";
interface CapabilityWhy {
	reason: HealthReason;
	mover: "agent" | "owner";
	contracts: string[];
	inside?: {
		capability: string;
		title: string;
	}[];
	since?: string;
}
interface HealthWorkItem {
	capability: string;
	title: string;
	story: string;
	status: CapabilityStatus;
	why: CapabilityWhy;
	since: string;
	waits?: PendingRun;
	contractsPass?: true;
	failure?: string;
}
interface PendingRun {
	since: string;
	by?: string;
	note?: string;
}
interface ChangedOnMain {
	commit: string;
	at: string;
}
interface NamedOnMain extends ChangedOnMain {
	contracts: readonly string[];
}
interface AnnotatedEdge extends Omit<EdgeNode, "contracts"> {
	contracts: AnnotatedContract[];
}
interface AnnotatedStory extends Omit<StoryNode, "capabilities" | "edges"> {
	capabilities: AnnotatedCapability[];
	edges?: AnnotatedEdge[];
	health: NodeHealth;
}
interface AnnotatedTree {
	anchor?: Anchor;
	stories: AnnotatedStory[];
	arcs: ArcNode[];
	unverified?: true;
}
declare class HealthRecord {
	#private;
	constructor(records: SchemaRecords, work: WorkModel, flight?: Pick<WorkInFlight, "releaseOnVerdict" | "holds" | "createArc" | "addIncrement" | "editIncrement">);
	reportHealth(contractId: string, state: HealthState, options?: HealthOptions): Promise<HealthEntry>;
	recordVerified(contractId: string, state: HealthState, options?: HealthOptions): Promise<HealthEntry>;
	recordVerifiedAll(verdicts: readonly VerifiedVerdict[], { signal }?: Pick<WriteOptions, "signal">): Promise<(HealthEntry | undefined)[]>;
	tellUntold(from: string, options?: WriteOptions): Promise<ToldTurn[]>;
	investigateFlake(flake: FlakeSeen, write?: WriteOptions): Promise<string | undefined>;
	recordUnclaimed(capabilityId: string, state: HealthState, options?: HealthOptions): Promise<HealthEntry>;
	recordObserved(contractId: string, state: "passing" | "failing", { machine, evidence, ...write }: {
		machine: string;
		evidence: string;
	} & WriteOptions): Promise<HealthEntry>;
	markVerifiedPending(contractId: string, options?: HealthOptions): Promise<HealthEntry>;
	health(nodeId: string, { now }?: {
		now?: Date;
	}): Promise<NodeHealth>;
	healthHistory(contractId: string): Promise<HealthEntry[]>;
	annotate(tree?: ProjectTree, parked?: ReadonlyMap<string, readonly ParkedOn[]>, now?: Date): Promise<AnnotatedTree>;
	worklist({ now, changed, named }?: {
		now?: Date;
		changed?: ReadonlyMap<string, ChangedOnMain>;
		named?: NamedOnMain;
	}): Promise<HealthWorkItem[]>;
}
type NewDecision = Omit<FieldsOf<"decision">, "composed">;
type DecisionStatus = FieldsOf<"decision">["status"] | "superseded";
interface DecisionView {
	readonly record: SchemaRecord<"decision">;
	readonly status: DecisionStatus;
	readonly supersededBy: string[];
	readonly supersededInPart: ClauseSupersession[];
	readonly composed?: {
		readonly statement: string;
		readonly composedAt: string;
		readonly stale: boolean;
	};
}
type ClauseSupersession = NonNullable<FieldsOf<"decision">["supersedesClauses"]>[number];
interface NarrowsMove {
	readonly decisions: string[];
	readonly edges: number;
	readonly partial: number;
}
interface SupersessionPair {
	readonly kind: "no-note" | "no-edge";
	readonly from: string;
	readonly to: string;
}
interface SupersessionPairs {
	readonly flagged: SupersessionPair[];
	readonly backlog: number;
}
type ArchivedLink = NonNullable<FieldsOf<"decision">["archivedLinks"]>[number];
interface ArchivedDecisionLink extends ArchivedLink {
	readonly from: string;
}
interface DecisionLinkTarget {
	readonly number: number | undefined;
	readonly title: string;
	readonly links: number;
}
interface DecisionLinkBacklog {
	readonly links: number;
	readonly decisions: number;
	readonly targets: readonly DecisionLinkTarget[];
}
interface DecisionLinkCounts {
	readonly pruned: number;
	readonly restored: number;
	readonly justified: number;
	readonly corrected: number;
	readonly added: number;
	readonly decisions: number;
}
interface DecisionLinkDay extends DecisionLinkCounts {
	readonly day: string;
}
interface DecisionLinkChanges {
	readonly days: DecisionLinkDay[];
	readonly total: DecisionLinkCounts;
}
interface DecisionLinkSpan {
	readonly from?: string | undefined;
	readonly to?: string | undefined;
	readonly by?: string | undefined;
}
interface DecisionNumberPlan {
	readonly id: string;
	readonly oldNumber: number | undefined;
	readonly number: number | undefined;
	readonly refusal?: string;
}
type VerbInput = {
	readonly kind: "text";
	readonly describe: string;
	readonly word?: number;
	readonly optional?: true;
	readonly many?: true;
	readonly blank?: true;
	readonly verbatim?: true;
} | {
	readonly kind: "yes-no";
	readonly describe: string;
} | {
	readonly kind: "switch";
	readonly describe: string;
} | {
	readonly kind: "count";
	readonly describe: string;
	readonly optional?: true;
} | {
	readonly kind: "fields";
	readonly describe: string;
	readonly json?: true;
};
type VerbInputs = Readonly<Record<string, VerbInput>>;
type InputOf<I extends VerbInputs> = {
	readonly [K in keyof I]: I[K] extends {
		kind: "text";
		many: true;
	} ? readonly string[] : I[K] extends {
		kind: "text";
		optional: true;
	} ? string | undefined : I[K] extends {
		kind: "text";
	} ? string : I[K] extends {
		kind: "yes-no" | "switch";
	} ? boolean : I[K] extends {
		kind: "count";
		optional: true;
	} ? number | undefined : I[K] extends {
		kind: "count";
	} ? number : I[K] extends {
		kind: "fields";
		json: true;
	} ? Readonly<Record<string, unknown>> : I[K] extends {
		kind: "fields";
	} ? Readonly<Record<string, string>> : VerbValue;
};
type VerbValue = string | number | boolean | undefined | readonly string[] | Readonly<Record<string, unknown>>;
interface Step {
	readonly tool?: string;
	readonly command?: string;
}
interface DoorWords {
	readonly door: "command" | "tool";
	say(step: Step): string;
}
interface VerbPlace {
	readonly folder: string;
	readonly session?: string;
	readonly harness?: string;
}
interface VerbContext extends VerbPlace {
	readonly library: Library;
	readonly project: string;
	readonly session: string;
	readonly harness?: string;
	readonly branch?: string;
	readonly writer?: WriteOptions;
	readonly home?: string;
	readonly server?: Pick<Storytree, "ownDatabase">;
}
interface VerbAnswer {
	readonly text: string;
	readonly raw?: true;
	readonly data?: Record<string, unknown>;
	readonly next?: readonly (Step & {
		readonly why: string;
	})[];
}
interface Absent {
	readonly absent: string;
	readonly twin?: string;
}
type Consumer = "agent" | "user" | "watcher";
interface Verb<I extends VerbInputs = VerbInputs, C extends VerbPlace = VerbContext> {
	readonly command: {
		readonly family: string;
		readonly name: string;
		readonly summary: string;
		readonly usage?: string;
	} | Absent;
	readonly tool: {
		readonly name: string;
		readonly description: string;
	} | Absent;
	readonly inputs: I;
	readonly agentOnly?: string;
	readonly consumers?: readonly Consumer[];
	readonly callerless?: true;
	readonly writes?: true;
	act(input: InputOf<I>, context: C, words: DoorWords): Promise<VerbAnswer>;
}
interface VerbFamilies<C extends VerbPlace = VerbContext> {
	readonly name: string;
	readonly aliases?: readonly string[];
	readonly summary: string;
	readonly verbs: readonly Verb<VerbInputs, C>[];
	readonly bare?: Verb<VerbInputs, C>;
	readonly families?: readonly VerbFamilies<C>[];
	readonly guesses?: Readonly<Record<string, string>>;
	readonly retired?: Readonly<Record<string, {
		readonly why: string;
		readonly instead: string;
	}>>;
}
interface VerbFamily<C extends VerbPlace = VerbContext> extends VerbFamilies<C> {
	readonly order: number;
}
interface Embedder {
	readonly model: string;
	readonly queryPrefix?: string;
	embed(texts: readonly string[]): Promise<Float32Array[]>;
}
type EmbedderSource = () => Promise<Embedder>;
interface VectorStore {
	get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>>;
	put(model: string, vectors: ReadonlyMap<string, Float32Array>): Promise<void>;
}
interface RelatedOptions {
	readonly unlinked?: boolean;
	readonly kind?: string;
	readonly limit?: number;
}
interface RelatedHit {
	readonly id: string;
	readonly type: string;
	readonly title: string;
	readonly score: number;
	readonly matched: string[];
	readonly linked: boolean;
	readonly linkVia: string[];
}
interface Related {
	readonly source: string;
	readonly terms: string[];
	readonly scanned: number;
	readonly linkedCount: number;
	readonly hits: RelatedHit[];
}
type NoteType = "decision" | "definition" | KnowledgeKind;
type NewKnowledge<K extends KnowledgeKind = KnowledgeKind> = K extends "friction" ? Omit<FieldsOf<K>, "state"> : FieldsOf<K>;
type Note = SchemaRecord<NoteType>;
interface Ranking {
	readonly embedder: EmbedderSource;
	readonly vectors: VectorStore;
}
type PlanKind = "story" | "capability" | "contract" | "arc" | "increment";
type Findable = Note | SchemaRecord<PlanKind>;
interface Ranked<T extends SchemaRecord = Note> {
	readonly by: "meaning" | "words";
	readonly why?: string;
	readonly hits: {
		readonly note: T;
		readonly score?: number;
		readonly narrowedBy?: readonly NarrowingDecision[];
	}[];
}
interface NarrowingDecision {
	readonly id: string;
	readonly number?: number;
	readonly clauses?: readonly string[];
}
interface RankOptions {
	readonly limit?: number;
	readonly history?: boolean;
	readonly kinds?: readonly (NoteType | PlanKind)[];
}
type PhraseKind = NoteType | PlanKind | "question";
interface PhraseOptions {
	readonly kinds?: readonly PhraseKind[];
	readonly fields?: readonly string[];
	readonly limit?: number;
	readonly after?: string;
}
interface PhrasePage {
	readonly records: SchemaRecord<PhraseKind>[];
	readonly next?: string;
}
type NewDefinition = FieldsOf<"definition">;
type EditOptions = WriteOptions & {
	readonly checkCurrent?: (note: Note) => void;
};
type NoteEdit = {
	[K in NoteType]: {
		[F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined;
	};
}[NoteType];
type RemedyClose = {
	readonly landed: true;
	readonly stamp: string;
} | {
	readonly landed: false;
	readonly undoing?: string | undefined;
	readonly remediedElsewhere: boolean;
};
declare class Knowledge {
	#private;
	constructor(records: SchemaRecords, project?: string, ranking?: Partial<Ranking>);
	recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">>;
	setDecisionNumberFloor(floor: number, options?: WriteOptions & {
		readonly apply?: boolean;
	}): Promise<number>;
	numberDecision(id: string, number: number, options?: WriteOptions): Promise<SchemaRecord<"decision">>;
	decisionNumberPlan(): Promise<DecisionNumberPlan[]>;
	numberDecisionsFromFullRecord(options?: WriteOptions & {
		readonly apply?: boolean;
	}): Promise<DecisionNumberPlan[]>;
	numberFoundingDecisions(options?: WriteOptions & {
		readonly apply?: boolean;
	}): Promise<DecisionNumberPlan[]>;
	decision(id: string): Promise<DecisionView | null>;
	decisions(): Promise<DecisionView[]>;
	composeStatement(id: string, statement: string, options?: WriteOptions): Promise<SchemaRecord<"decision"> | null>;
	moveNarrowsToClauses(options?: WriteOptions): Promise<NarrowsMove>;
	supersessionPairs(): Promise<SupersessionPairs>;
	decisionLinkBacklog(): Promise<DecisionLinkBacklog>;
	decisionLinkChanges(span?: DecisionLinkSpan): Promise<DecisionLinkChanges>;
	archivedLinks(from?: string): Promise<ArchivedDecisionLink[]>;
	pruneLink(from: string, to: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"decision">>;
	restoreLink(from: string, to: string, justification?: string, options?: WriteOptions): Promise<SchemaRecord<"decision">>;
	writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K>>;
	defineTerm(definition: NewDefinition, options?: WriteOptions): Promise<SchemaRecord<"definition">>;
	refile<K extends KnowledgeKind>(id: string, kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K> | null>;
	editNote(id: string, fields: NoteEdit, options?: EditOptions): Promise<Note | null>;
	settleRemedy(id: string, close: RemedyClose, options?: WriteOptions): Promise<SchemaRecord<"friction"> | null>;
	search(query: string): Promise<Note[]>;
	searchEach(queries: readonly string[]): Promise<Note[][]>;
	rank(query: string, options?: RankOptions): Promise<Ranked>;
	rankAll(query: string, options?: RankOptions): Promise<Ranked<Findable>>;
	findPhrase(phrase: string, options?: PhraseOptions): Promise<PhrasePage>;
	measures(story?: string): Promise<SchemaRecord<"measure">[]>;
	definitions(): Promise<SchemaRecord<"definition">[]>;
	relatedNotes(noteId: string): Promise<Note[]>;
	related(noteId: string, options?: RelatedOptions): Promise<Related | null>;
	relatedEach(noteIds: readonly string[], options?: RelatedOptions): Promise<Related[]>;
	frontCovers(nodeId: string): Promise<SchemaRecord<"decision">[]>;
}
type FactoryLink = {
	readonly kind: "factory";
} | {
	readonly kind: "product";
	readonly factory: string;
} | {
	readonly kind: "none";
};
declare class ProjectLineage {
	#private;
	constructor(pool: Pool, name: string);
	factory(): Promise<FactoryLink>;
	markFactory(): Promise<boolean>;
	recordFactory(name: string): Promise<void>;
}
type Reached<P> = {
	readonly project: string;
	readonly opened: P;
	readonly unopened?: undefined;
} | {
	readonly project: string;
	readonly opened?: undefined;
	readonly unopened: string;
};
interface SystemSwitches {
	readonly off: readonly string[];
	readonly on: readonly string[];
}
interface SnapshotRecord {
	id: string;
	type: string;
	version: number;
	fields: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
interface SnapshotEvent {
	seq: number;
	recordId: string;
	type: string;
	action: "created" | "updated" | "retired";
	record: unknown;
	reason?: string;
	actor?: string;
	outsideRead?: string[];
	at: string;
}
interface SnapshotMedia {
	recordId: string;
	name: string;
	type: string;
	size: number;
	sha256: string;
	addedAt: string;
	addedBy?: string;
	bytes: string;
}
interface ProjectSnapshot {
	format: "storytree-project-snapshot";
	version: 1;
	project: string;
	takenAt: string;
	records: SnapshotRecord[];
	history: SnapshotEvent[];
	media?: SnapshotMedia[];
}
interface OpenOptions {
	readonly create?: boolean;
	readonly identity?: string;
	readonly system?: SystemSwitches;
	readonly kinds?: readonly PluginRecordKind[];
}
interface OwnDatabaseOptions {
	readonly tables?: readonly string[];
	readonly declaredIn?: readonly (string | undefined)[];
}
interface Project {
	readonly name: string;
	readonly identity: string;
	readonly pool: Pool;
	readonly transactions: Transactions;
	readonly records: SchemaRecords;
	readonly work: WorkModel;
	readonly flight: WorkInFlight;
	readonly knowledge: Knowledge;
	readonly health: HealthRecord;
	readonly lineage: ProjectLineage;
	readonly factory: Project | undefined;
	reach(name: string): Promise<Project>;
	reachAll(): Promise<Reached<Project>[]>;
	close(): Promise<void>;
}
interface KindCount {
	readonly kind: string;
	readonly count: number;
	readonly statuses: readonly {
		readonly status: string;
		readonly count: number;
	}[];
}
interface Counts {
	readonly kinds: readonly KindCount[];
	readonly openByArc: readonly {
		readonly arc: string;
		readonly title: string | null;
		readonly open: number;
	}[];
}
interface RecentChange {
	readonly seq: number;
	readonly at: string;
	readonly action: string;
	readonly type: string;
	readonly id: string;
	readonly title: string | null;
}
interface TitleHit {
	readonly id: string;
	readonly type: string;
	readonly title: string | null;
}
declare class DataQuestions {
	#private;
	constructor(pool: Pool);
	counts(): Promise<Counts>;
	latestChanges(limit?: number): Promise<RecentChange[]>;
	findByTitle(words: readonly string[], options?: {
		readonly history?: boolean;
	}): Promise<TitleHit[]>;
	decisionNumbered(number: number): Promise<TitleHit | null>;
}
interface Storytree {
	openProject(name: string, options?: OpenOptions): Promise<Library>;
	listProjects(): Promise<string[]>;
	projectIdentities(): Promise<Record<string, string>>;
	snapshot(name: string): Promise<ProjectSnapshot>;
	restore(name: string, snapshot: ProjectSnapshot): Promise<void>;
	dropProject(name: string): Promise<void>;
	ownDatabase(name: string, options?: OwnDatabaseOptions): Promise<Pool>;
	close(): Promise<void>;
}
declare const FROM_RECORDS: readonly [
	"get",
	"history",
	"revert",
	"revertWrites",
	"writtenBy"
];
declare const FROM_WORK: readonly [
	"addStory",
	"editStory",
	"mapStories",
	"importPluginPlan",
	"addCapability",
	"editCapability",
	"setProposed",
	"addContract",
	"editContract",
	"addEdge",
	"editEdge",
	"dependsOn",
	"moveDependsOnToEdges",
	"anchor",
	"setAnchor",
	"prCutover",
	"setPrCutover"
];
declare const FROM_FLIGHT: readonly [
	"addIncrement",
	"advanceIncrement",
	"returnIncrement",
	"closeIncrement",
	"correctIncrementClosure",
	"moveIncrement",
	"editIncrement",
	"pendChange",
	"stalePending",
	"applyPending",
	"dropPending",
	"settleClosedPending",
	"openListing",
	"createArc",
	"editArc",
	"arcsFor",
	"parkArc",
	"unparkArc",
	"arcView",
	"arcViews",
	"boardArcs",
	"closedArcs",
	"addWait",
	"removeWait",
	"waitHolds",
	"addWaitFor",
	"removeWaitFor",
	"waitsFor",
	"holds",
	"raiseQuestion",
	"settleQuestion",
	"questions",
	"heldOnQuestion",
	"checkQuestion",
	"renewQuestion",
	"editQuestion",
	"linkNamedEvidence",
	"moveQuestion",
	"lapsedQuestions",
	"predictQuestion",
	"questionPrediction",
	"scoreQuestion",
	"prepQuestion",
	"questionDeviation"
];
declare const FROM_HEALTH: readonly [
	"reportHealth",
	"recordVerified",
	"recordVerifiedAll",
	"recordObserved",
	"recordUnclaimed",
	"markVerifiedPending",
	"tellUntold",
	"investigateFlake",
	"health",
	"healthHistory"
];
declare const FROM_KNOWLEDGE: readonly [
	"recordDecision",
	"numberDecision",
	"decisionNumberPlan",
	"numberDecisionsFromFullRecord",
	"setDecisionNumberFloor",
	"numberFoundingDecisions",
	"writeKnowledge",
	"defineTerm",
	"editNote",
	"search",
	"searchEach",
	"rank",
	"rankAll",
	"findPhrase",
	"relatedNotes",
	"related",
	"relatedEach",
	"definitions",
	"measures",
	"frontCovers",
	"decision",
	"decisions",
	"composeStatement",
	"moveNarrowsToClauses",
	"supersessionPairs",
	"decisionLinkBacklog",
	"decisionLinkChanges",
	"archivedLinks",
	"pruneLink",
	"restoreLink",
	"refile"
];
declare const FROM_LINEAGE: readonly [
	"factory",
	"markFactory",
	"recordFactory"
];
declare const FROM_DATA: readonly [
	"counts",
	"latestChanges",
	"findByTitle",
	"decisionNumbered"
];
interface Library extends Pick<Project["records"], (typeof FROM_RECORDS)[number]>, Pick<Project["work"], (typeof FROM_WORK)[number]>, Pick<Project["flight"], (typeof FROM_FLIGHT)[number]>, Pick<Project["health"], (typeof FROM_HEALTH)[number]>, Pick<Project["knowledge"], (typeof FROM_KNOWLEDGE)[number]>, Pick<Project["lineage"], (typeof FROM_LINEAGE)[number]>, Pick<DataQuestions, (typeof FROM_DATA)[number]> {
	readonly name: string;
	readonly identity: string;
	list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]>;
	inherited(): Promise<SchemaRecord[]>;
	naming(id: string): Promise<SchemaRecord[]>;
	linkingIn(id: string): Promise<SchemaRecord[]>;
	factoryLibrary(): Library | undefined;
	reach(name: string): Promise<Library>;
	reachAll(): Promise<Reached<Library>[]>;
	workSurvey(at?: Date, options?: Omit<SurveyOptions, "empty">): Promise<WorkSurvey>;
	projectTree(options?: {
		readonly pendingOf?: string | undefined;
	}): Promise<AnnotatedTree>;
	healthWorklist(options?: {
		readonly changed?: ReadonlyMap<string, ChangedOnMain>;
		readonly named?: NamedOnMain;
	}): Promise<HealthWorkItem[]>;
	retireQuestion(id: string, reason: string, options?: WriteOptions): Promise<string[] | null>;
	retire(id: string, reason: string, options?: WriteOptions): Promise<void>;
	inOneWrite<T>(work: () => Promise<T>, options?: {
		readonly signal?: AbortSignal;
	}): Promise<T>;
	changesSince(cursor: number, filter?: ChangesFilter): Promise<Changes>;
	sendFeedback(note: FeedbackNote, options?: WriteOptions & {
		readonly screenshot?: Uint8Array | undefined;
		readonly crop?: Uint8Array | undefined;
	}): Promise<SchemaRecord<"feedback">>;
	feedbackScreenshot(id: string, options?: {
		readonly element?: boolean;
	}): Promise<Uint8Array | null>;
	routeFeedback(id: string, route: FeedbackRoute, options?: WriteOptions): Promise<SchemaRecord<"feedback"> | null>;
	recordFyi(fyi: FyiNote, options?: WriteOptions): Promise<SchemaRecord<"fyi">>;
	unheardFyis(): Promise<SchemaRecord<"fyi">[]>;
	markFyisHeard(ids: readonly string[], options?: WriteOptions): Promise<string[]>;
	recordPin(pin: PinNote, options?: WriteOptions): Promise<SchemaRecord<"pin">>;
	createPluginRecord(kind: string, fields: Record<string, unknown>, options?: WriteOptions): Promise<SchemaRecord>;
	editPluginRecord(id: string, fields: Record<string, unknown>, options?: WriteOptions & {
		readonly checkCurrent?: (record: SchemaRecord) => void;
	}): Promise<SchemaRecord | null>;
	pluginRecords(plugin: string): Promise<PluginRecords>;
	removePluginRecords(listed: PluginRecords, reason: string, options?: WriteOptions): Promise<PluginRecords>;
	dormantKinds(): Promise<readonly DormantKind[]>;
	attachMedia(id: string, file: NewMedia, options?: WriteOptions & {
		readonly replace?: boolean;
	}): Promise<AttachedMedia>;
	media(id: string): Promise<MediaEntry[]>;
	mediaFile(id: string, name: string): Promise<MediaFile | null>;
	close(): Promise<void>;
}
interface NewMedia {
	readonly name: string;
	readonly type: string;
	readonly bytes: Uint8Array;
}
interface MediaEntry {
	readonly recordId: string;
	readonly name: string;
	readonly type: string;
	readonly size: number;
	readonly sha256: string;
	readonly addedAt: string;
	readonly addedBy?: string;
}
interface MediaFile extends MediaEntry {
	readonly bytes: Uint8Array;
}
interface AttachedMedia extends MediaEntry {
	readonly outcome: "added" | "same" | "replaced";
}
interface PluginRecords {
	readonly plugin: string;
	readonly kinds: readonly {
		readonly kind: string;
		readonly count: number;
		readonly ids: readonly string[];
	}[];
}
interface DormantKind {
	readonly kind: string;
	readonly count: number;
}
type FeedbackNote = Omit<FieldsOf<"feedback">, "status" | "screenshot" | "crop" | keyof FeedbackRoute>;
type FyiNote = Omit<FieldsOf<"fyi">, "at" | "heardAt"> & {
	readonly at?: string | undefined;
};
type PinNote = Omit<FieldsOf<"pin">, "at"> & {
	readonly at?: string | undefined;
};
interface FeedbackRoute {
	readonly route: NonNullable<FieldsOf<"feedback">["route"]>;
	readonly routedTo?: string;
	readonly routeReason: string;
}
interface Change {
	seq: number;
	recordId: string;
	type: string;
	action: HistoryEntry["action"];
	record: RecordEnvelope;
}
interface ChangesFilter {
	readonly types?: readonly string[];
	readonly actions?: readonly HistoryEntry["action"][];
	readonly fields?: readonly string[];
	readonly healthColumns?: readonly string[];
}
interface Changes {
	changes: Change[];
	cursor: number;
}
export declare const mediaGuidance: readonly string[];
export declare const PROJECT_INPUT: {
	readonly kind: "text";
	readonly optional: true;
	readonly describe: "Read this project's library instead of this folder's: its factory's, or a project that factory builds";
};
export declare const PROJECTS_INPUT: {
	readonly kind: "text";
	readonly many: true;
	readonly optional: true;
	readonly describe: "Search these projects' libraries instead of this folder's (its factory's, or projects it builds), each result under its project; all for every one";
};
export declare function libraryNamed(library: Library, project: string | undefined): Promise<Library>;
export declare function contextIn<C extends VerbContext>(context: C, project: string | undefined): Promise<C>;
export declare function librariesNamed(library: Library, projects?: readonly string[]): Promise<Reached<Library>[]>;
export declare function unopenedSaid(project: string, why: string): string;
export type Found = Extract<NewLine, {
	kind: "note-read";
}>["found"];
export interface NoteRead {
	readonly note: string;
	readonly found: Found;
	readonly read: "peek" | "whole";
}
export interface Presenter {
	readonly session: string;
	readonly label: string;
	readonly since: string;
}
export interface NoteToolContext extends VerbContext {
	claims(): Promise<readonly HeldClaim[]>;
	notesRead(): Promise<readonly NoteRead[]>;
	recordReads(reads: readonly NoteRead[]): Promise<void>;
	presenterOf(question: SchemaRecord<"question">): Promise<Presenter | undefined>;
}
export declare const NOTE_TOOLS: readonly Verb<VerbInputs, NoteToolContext>[];
export interface HeldClaim {
	readonly session: string;
	readonly increment?: string | undefined;
	readonly capability?: string | undefined;
	readonly since: string;
	readonly branch?: string | undefined;
	readonly holder?: string | undefined;
}
export interface LibraryVerbContext extends VerbContext {
	claims(): Promise<readonly HeldClaim[]>;
	testedNumbers(capability: string): Promise<{
		readonly tested: readonly string[];
		readonly untested: readonly string[];
	}>;
	pluginInFactory?(plugin: string): Promise<boolean>;
	levelsBehind?(story: string, parent: string): Promise<string[]>;
}
export interface PhraseHit {
	readonly record: SchemaRecord<PhraseKind>;
	readonly title: string;
	readonly fields: readonly string[];
}
export declare function everyHolding(library: Library, phrase: string, options?: {
	kinds?: readonly PhraseKind[];
	fields?: readonly string[];
}): Promise<PhraseHit[]>;
export declare function holdingLines(phrase: string, hits: readonly PhraseHit[]): string;
type Stored = NonNullable<Awaited<ReturnType<Library["get"]>>>;
export declare function justificationSaid(fields: object, target: string, before: string): string;
export declare function supersededLines(library: Library, record: {
	readonly id: string;
	readonly type: string;
}): Promise<string[]>;
export declare function wholeRecord(record: Stored): string;
export declare function bareSaid(library: Library, capability: string | undefined, plan: string): Promise<string>;
export declare const LIBRARY_FAMILIES: readonly VerbFamily<LibraryVerbContext>[];

export {};
