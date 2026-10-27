// A stand-in for the storytree command line, for the voice door's tests only. By default it prints, as JSON, the argv
// it received, its working folder and the environment names the door must strip or set, so a test sees exactly what
// reached the child. A few command shapes answer as the real command line does (arc waits, question list, arc recent,
// library history, library list decision, library read of several ids, arc show of the parked arc …b4, library search for "seven hits"), so the tools'
// shaping of real output is exercised.
//
// An argv naming question_000000000000 plays a refusal (exit 1); "unusable" plays exit 2; "crash" exits 3 with a stack;
// "colour" answers with colour codes and a "next:" block. "sleep:<ms>" waits that long before answering, and
// "sleep:<ms>:stubborn" also ignores SIGTERM. Given a first argument --fake-log=<file> (an argument, because the door
// passes a child only a few named variables), it appends "start <pid> <epoch ms>" and "end <pid> <epoch ms>" lines there,
// each with its argv as JSON, so a test can count the children running at once and see which were stopped.
import { appendFileSync } from "node:fs";

const logFile = process.argv[2]?.startsWith("--fake-log=") ? process.argv[2].slice("--fake-log=".length) : undefined;
const argv = process.argv.slice(logFile === undefined ? 2 : 3);
const note = (word) => {
  if (logFile) appendFileSync(logFile, `${word} ${process.pid} ${Date.now()} ${JSON.stringify(argv)}\n`);
};
const NEXT = "\n\nnext:\n  - storytree library read <id>   (read one whole)\n";
const STACK = "    at fakeRefusal (fake-cli.mjs:6:1)\n    at node:internal/main/run_main_module:28:49\n";

note("start");
const refusal = [
  [argv.includes("question_000000000000"), 1, 'no question "question_000000000000" in this project'],
  [argv.includes("unusable"), 2, "unknown flag --unusable"],
  [argv.includes("crash"), 3, "TypeError: Cannot read properties of undefined (reading 'id')"],
].find(([when]) => when);
if (refusal) {
  process.stderr.write(`${refusal[2]}\n${STACK}`);
  note("end");
  process.exit(refusal[1]);
}

const hex = (n) => n.toString(16).padStart(12, "0");

function answer() {
  if (argv.includes("colour")) return `\u001b[1mBold\u001b[0m and \u001b[32mgreen\u001b[0m answer${NEXT}`;
  const [family, verb] = argv;
  if (family === "arc" && verb === "waits") {
    return (
      "3 waits for you or an outside event:\n" +
      "  - you    PR #1656 is still red after 2 fix sessions: verify on Windows failed. — increment_0000000000a1  Feedback corner, on arc_0000000000b1  The owner gives UI feedback\n" +
      "  - you    Clear this wait when the owner wants it built. — increment_0000000000a2  Choose your own factory, on arc_0000000000b2  Bring your own factory\n" +
      "  - event  PR #1720 is open and green and handed to the watcher. — increment_0000000000a3  Follow-main is retired, on arc_0000000000b3  Stability; check back 2026-10-26\n" +
      "20 more for you wait on a parked arc until it is unparked: arc_0000000000b8, arc_0000000000b9 (storytree arc show <arc> names them)." +
      NEXT
    );
  }
  if (family === "question" && verb === "list") {
    // In id order, as the real list is: question_…c1 is the newest, question_…c3 the oldest.
    return (
      "3 open across arcs:\n" +
      "  - question_0000000000c1  [arc_0000000000b1]  Newest: keep the secret address alone?\n" +
      "  - question_0000000000c2  [arc_0000000000b2]  Middle: count renderer builds as tests?\n" +
      "  - question_0000000000c3  [arc_0000000000b3]  Oldest: a per-change mutation report?\n" +
      "1 more waits on a parked arc until it is unparked: arc_0000000000b9 (storytree question list --arc <arc> names them)." +
      NEXT
    );
  }
  if (family === "library" && verb === "read" && argv.length > 3) {
    const created = { question_0000000000c1: "2026-10-23T09:00:00.000Z", question_0000000000c2: "2026-10-20T09:00:00.000Z", question_0000000000c3: "2026-10-01T09:00:00.000Z" };
    return argv.slice(2).map((id) => `${id}  [question]  schema 2\nCreated: ${created[id] ?? "2026-10-22T00:00:00.000Z"}\nUpdated: 2026-10-23T00:00:00.000Z\n\ntitle: ${id}\n`).join("\n") + NEXT;
  }
  if (family === "arc" && verb === "recent") {
    const lines = [`25 landed since 2026-10-22 10:00 UTC, on 3 arcs:`];
    for (let arc = 1; arc <= 3; arc++) {
      lines.push(`  arc_${hex(0xd0 + arc)}  Arc number ${arc}`);
      const count = arc === 1 ? 15 : 5;
      for (let at = 1; at <= count; at++) lines.push(`    increment_${hex(arc * 100 + at)}  Work ${arc}.${at} landed (#${1000 + arc * 100 + at})`);
    }
    lines.push("2 arcs closed since then:", `  arc_${hex(0xe1)}  An arc that closed (closed 2026-10-23)`);
    return `${lines.join("\n")}\n\nsince: ${argv[argv.indexOf("--since") + 1]}${NEXT}`;
  }
  if (family === "library" && verb === "history") {
    const lines = [`History of ${argv[2]}:`];
    for (let at = 1; at <= 25; at++) lines.push(`  ${700000 + at}  2026-10-${String(at).padStart(2, "0")}T09:00:00.000Z  ${at === 1 ? "created" : "updated"}  session:writer-${at}`);
    return lines.join("\n") + NEXT;
  }
  if (family === "library" && verb === "list" && argv.includes("number=1103")) {
    return `1 decision records:\n  decision_0000000011a3  The decision numbered 1103${NEXT}`;
  }
  if (family === "library" && verb === "list" && argv.includes("number=3")) {
    return `1 decision records:\n  decision_000000000003  The decision numbered 3${NEXT}`;
  }
  if (family === "library" && verb === "list" && argv[2] === "decision") return `0 decision records:${NEXT}`;
  if (family === "library" && verb === "list" && argv[2] === "definition") {
    return `2 definition records:\n  definition_0000000000f1  Owner question\n  definition_0000000000f2  Watcher${NEXT}`;
  }
  if (family === "arc" && verb === "list") {
    return (
      "3 arcs:\n" +
      "  arc_0000000000b1  [active]  priority 1  The owner gives UI feedback\n" +
      "  arc_0000000000b2  [parked]  Bring your own factory\n" +
      "  arc_0000000000b3  [active]  Stability and testing rigour\n" +
      "  arc_0000000000b4  [parked]  priority 1  Hardening before the public launch\n" +
      "  arc_0000000000b5  [closed 2026-10-24]  Hardening the old release process" +
      NEXT
    );
  }
  if (family === "arc" && verb === "show" && argv[2] === "arc_0000000000b4") {
    // Twenty open increments, as the real `arc show` lists them; the third waits on the second, the fifth on the owner.
    const work = Array.from({ length: 20 }, (_, at) => {
      const line = `  - increment_${hex(0x400 + at + 1)}  [proposal]  Hardening step ${at + 1}`;
      if (at === 2) return `${line}\n      waits on increment_${hex(0x402)}: Plan order from the security audit: step 2 first.`;
      if (at === 4) return `${line}\n      waiting on you: question question_0000000000c2`;
      return line;
    });
    return (
      "Hardening before the public launch  [arc_0000000000b4]  parked\n\nIntent: Harden it.\nEnd state: Hardened.\nPriority: 1\n\n" +
      `Work (20 open)\n${work.join("\n")}\n\nQuestions waiting on you (0)\n\nIncrement log (1 closed)\n  - 2026-10-24  landed  1700  increment_${hex(0x4ff)}  An earlier step` +
      NEXT
    );
  }
  if (family === "library" && verb === "count") {
    return (
      "Live records by kind:\n  decision           503: accepted 491, proposed 12\n  question           216: settled 206, open 10\n\n" +
      "Open increments by arc:\n  86 open  arc_bfbc3b617d69  Hardening before the public launch\n  8 open  arc_7c7b7f22a027  Voice sessions reach storytree live" +
      NEXT
    );
  }
  if (family === "library" && verb === "find") {
    const words = argv.at(-1);
    if (words === "voice door") {
      const hits = Array.from({ length: 7 }, (_, at) => `  increment_${hex(0xf00 + at)}  [increment]  Voice door step ${at + 1}`);
      return `titles holding "voice door":\n${hits.join("\n")}${NEXT}`;
    }
    // A slow call (the gate tests') is answered by its title lookup alone: one child per find.
    if (/^sleep:/.test(words)) return `titles holding "${words}":\n  note_${hex(0x51)}  [principle]  A slow answer${NEXT}`;
    return `No titles holding "${words}".${NEXT}`;
  }
  if (family === "question" && verb === "show" && argv[2] === "question_0000000000c1") {
    const filler = Array.from({ length: 250 }, (_, at) => `Sentence ${at + 1} of the stakes, naming arc_0000000000b1 and the cost.`).join(" ");
    return `Newest: keep the secret address alone?  [question_0000000000c1]\nOn arc_0000000000b1, open.\n\nStakes:\n${filler}\n\nOptions:\n(a) Keep it. Good: nothing to do. Bad: anyone with the address.\n(b) Sign in. Good: tied to you. Bad: setup.\n\nRecommendation:\n(b): the address alone is a password anyone can forward.${NEXT}`;
  }
  if (family === "library" && verb === "read" && argv[2] === "decision_000000000003") {
    return (
      "decision_000000000003  [decision]  schema 2\nCreated: 2026-10-01T00:00:00.000Z\nUpdated: 2026-10-02T00:00:00.000Z\n\n" +
      'number: 3\nstatus: accepted\ntext: Open questions are mirrored to Drive (see research_0000000000aa).\nlinks: [\n  "research_0000000000aa"\n]\noutcome: {\n  "pr": "1723",\n  "disposition": "landed"\n}\n' +
      "title: The decision numbered 3" +
      NEXT
    );
  }
  if (family === "library" && verb === "search" && argv.at(-1) === "seven hits") {
    const hits = Array.from({ length: 7 }, (_, at) => `  0.${90 - at}  note_${hex(at + 1)}  [principle]  Principle number ${at + 1}`);
    return `closest in meaning to "seven hits":\n${hits.join("\n")}${NEXT}`;
  }
  const env = process.env;
  const watched = /^(VOICE_TOKEN|VOICE_SPIKE_TOKEN|PORT|REPO_DIR|ALLOWED_HOSTS|ALLOWED_CIDRS|STORYTREE_CLI|CLAUDE_CODE_SESSION_ID|CODEX_THREAD_ID|CURSOR_CONVERSATION_ID|PI_SESSION_ID|STORYTREE_SESSION_ID)$/i;
  return (
    JSON.stringify({
      argv,
      cwd: process.cwd(),
      pid: process.pid,
      env: Object.fromEntries(Object.entries(env).filter(([name]) => watched.test(name))),
      names: Object.keys(env).sort(),
    }) + NEXT
  );
}

const sleep = argv.map((part) => /^sleep:(\d+)(:stubborn)?$/.exec(part)).find(Boolean);
if (sleep?.[2]) process.on("SIGTERM", () => {});
setTimeout(() => {
  process.stdout.write(answer());
  note("end");
}, sleep ? Number(sleep[1]) : 0);
