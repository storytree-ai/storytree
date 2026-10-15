/**
 * Capability 2 · The printed table. A reading for a person in a terminal: the short window's numbers with the long window's beside
 * them, leading with what the owner asked to see first (every command and tool with its consumers and its use, one with
 * no call marked unused, or not judged when a person may call it (ADR-1045 D1), and the misses), then follows, failures, refusals, door share per step and the splits (ADR-0983 D2). The
 * same two readings as JSON, for a script that compares numbers rather than printed text.
 */
import type { Door, Reading } from "./reading.js";

/** The two readings as JSON: the short window and the long. */
export function doorsJson(short: Reading, long: Reading): string {
  return `${JSON.stringify({ short, long }, null, 2)}\n`;
}

/** The two readings as plain text. */
export function doorsTable(short: Reading, long: Reading): string {
  const sd = span(short);
  const ld = span(long);
  const out: string[] = [
    `Front doors, ${day(short.since)} to ${day(short.until)} (${sd} days), with the ${ld} days to ${day(long.until)} beside it.`,
    `Calls: ${short.calls.command} command line, ${short.calls.tool} tool, in ${short.sessions} sessions (${ld} days: ${long.calls.command}, ${long.calls.tool}, in ${long.sessions}).`,
  ];
  const surface = (door: Door, declared: boolean) => long.surfaces.filter((one) => one.door === door && one.declared === declared).map((one) => {
    const near = short.surfaces.find((other) => other.door === door && other.verb === one.verb);
    const use = [String(near?.calls ?? 0), String(near?.sessions ?? 0), String(one.calls), String(one.sessions)];
    if (!declared) return [one.verb, ...use];
    return [one.verb, (one.consumers ?? []).join(", "), ...use, !one.judged ? "not judged" : one.calls === 0 ? "unused" : ""];
  });
  const heads = [`calls ${sd}d`, `sessions ${sd}d`, `calls ${ld}d`, `sessions ${ld}d`];
  section(out, "Commands", ["consumers", ...heads, ""], surface("command", true));
  section(out, "Tools", ["consumers", ...heads, ""], surface("tool", true));
  out.push(`Unused: no call in ${ld} days. Not judged: a person may call it, and a person's own terminal writes no line.`);
  section(out, "Answered by neither door's list (help, a family a word was refused in)", heads, [...surface("command", false), ...surface("tool", false)]);

  section(out, "Words refused as unknown", [`${sd}d`, `${ld}d`, "the refusal named"], long.misses.map((miss) => {
    const near = short.misses.find((other) => other.door === miss.door && other.where === miss.where && other.word === miss.word);
    return [`${miss.where} ${miss.word}`, String(near?.count ?? 0), String(miss.count), miss.named === undefined ? "nothing" : `→ ${miss.named}`];
  }).sort((a, b) => Number(b[1]) - Number(a[1]) || Number(b[2]) - Number(a[2])));
  out.push(`Unknown per 1,000 calls: command line ${rate(short.unknownPer1000.command)} (${ld} days ${rate(long.unknownPer1000.command)}), tools ${rate(short.unknownPer1000.tool)} (${rate(long.unknownPer1000.tool)}).`);

  section(out, `Next steps offered, ${sd} days`, ["offered", "followed", "follow rate", "baseline"], short.follows.map((follow) => [
    `→ ${follow.step}`, String(follow.offered), String(follow.followed), percent(follow.followed, follow.answered), percent(follow.baseline.took, follow.baseline.calls),
  ]));
  out.push("Follow rate: of the offers the session called again after; baseline: how often the same previous verbs led to the step when it was not offered.");

  section(out, "Failures by class", [`${sd}d`, `${ld}d`], long.failures.map((failure) => {
    const near = short.failures.find((other) => other.door === failure.door && other.verb === failure.verb && other.class === failure.class);
    return [`${failure.verb} ${failure.class}`, String(near?.count ?? 0), String(failure.count)];
  }));
  section(out, "Refused by design (a guard's or the library's no)", [`${sd}d`, `${ld}d`], long.refusals.map((refusal) => {
    const near = short.refusals.find((other) => other.door === refusal.door && other.verb === refusal.verb);
    return [refusal.verb, String(near?.count ?? 0), String(refusal.count)];
  }));

  section(out, `Door share per step, ${sd} days`, ["command line", "tool", "tool share", `tool share ${ld}d`], short.steps.map((step) => {
    const far = long.steps.find((other) => other.step === step.step);
    return [step.step, String(step.command), String(step.tool), percent(step.tool, step.command + step.tool), percent(far?.tool ?? 0, (far?.command ?? 0) + (far?.tool ?? 0))];
  }));
  section(out, `Split, ${sd} days`, ["command line", "tool", "sessions", "unknown"], short.splits.map((split) => [
    `${split.by}: ${split.value}`, String(split.command), String(split.tool), String(split.sessions), String(split.unknown),
  ]));
  out.push("Briefed is read as a session given at most one prompt, as a lane is given its brief; the lines carry no other sign of one.");
  return `${out.join("\n")}\n`;
}

/** A titled block of rows, its columns padded apart by at least two spaces; "none" when it has no rows. */
function section(out: string[], title: string, heads: readonly string[], rows: readonly (readonly string[])[]): void {
  out.push("", rows.length === 0 ? `${title}: none.` : title);
  if (rows.length === 0) return;
  const table = [["", ...heads], ...rows];
  const widths = table[0]!.map((_, column) => Math.max(...table.map((row) => row[column]?.length ?? 0)));
  for (const row of table) {
    out.push(`  ${row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!))).join("  ").trimEnd()}`);
  }
}

function span(reading: Reading): number {
  return Math.round((Date.parse(reading.until) - Date.parse(reading.since)) / (24 * 60 * 60 * 1000));
}

function day(at: string): string {
  return at.slice(0, 10);
}

function rate(value: number | null): string {
  return value === null ? "–" : String(value);
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "–" : `${Math.round((100 * part) / whole)}%`;
}
