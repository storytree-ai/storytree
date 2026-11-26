import { z } from 'zod';

type RecordType = "arc" | "story" | "capability" | "contract" | "edge" | "health" | "decision" | "decisionNumbering" | "anchor" | "prCutover" | "definition" | KnowledgeKind | "increment" | "question" | "prediction" | "feedback" | "fyi" | "pin";
type KnowledgeKind = "principle" | "guardrail" | "pattern" | "process" | "agent" | "friction" | "resteer" | "techstack" | "check" | "research" | "experiment" | "escape" | "drill" | "measure";
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
export type PrCutover = FieldsOf<"prCutover">;
export declare const PR_CUTOVER_ID = "pr-cutover";
export declare const historyOf: (repository: string) => string;
export declare function beforeCutover(cutover: PrCutover | undefined, when: string): boolean;
export declare function pullRepository(cutover: PrCutover | undefined, pr: string, when: string, current: string): string | null | undefined;
export declare function pullSaid(cutover: PrCutover | undefined, pr: string, when: string): string;

export {};
