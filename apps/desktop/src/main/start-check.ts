// Capability 4 · Updates
import { spawn } from "node:child_process";

export const START_CHECK_TIMEOUT_MS = 60_000;
const SAID_CHARS = 600;

const UNHANDLED = /UnhandledPromiseRejectionWarning: (?!Unhandled promise rejection\.)([^\r\n]*)/;

export function startsCleanly(launch: { execPath: string; args: readonly string[]; env?: NodeJS.ProcessEnv }, timeoutMs = START_CHECK_TIMEOUT_MS): Promise<string | undefined> {
  const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = launch.env ?? process.env;
  return new Promise((resolve) => {
    let said = "";
    let heard = "";
    let printedChars = 0;
    let rejection: string | undefined;
    const began = performance.now();
    let spawnedAfter: number | undefined;
    let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    const child = spawn(launch.execPath, [...launch.args, "--start-check"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.on("spawn", () => { spawnedAfter = Math.round(performance.now() - began); });
    child.on("exit", (code, signal) => { exited = { code, signal }; });
    const hear = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      printedChars += text.length;
      if (said.length < SAID_CHARS) said = (said + text).slice(0, SAID_CHARS);
      heard = (heard + text).slice(-2 * SAID_CHARS);
      rejection ??= UNHANDLED.exec(heard)?.[1]?.trim();
    };
    child.stdout.on("data", hear);
    child.stderr.on("data", hear);
    const timer = setTimeout(() => {
      const processState = exited === undefined ? "still running" : `exited with ${exited.code === null ? `signal ${exited.signal}` : `code ${exited.code}`}`;
      const output = printedChars > SAID_CHARS ? `${said}\n…\n${heard.slice(-SAID_CHARS)}` : said;
      const evidence = [
        `process ${child.pid ?? "unknown"}: ${spawnedAfter === undefined ? "spawn not observed" : `spawned after ${spawnedAfter} ms`}, ${processState}`,
        `stdout ${child.stdout.readableEnded ? "ended" : "open"}, stderr ${child.stderr.readableEnded ? "ended" : "open"}`,
        `elapsed ${Math.round(performance.now() - began)} ms`,
      ].join("; ");
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(`it did not finish starting within ${timeoutMs / 1000} s (${evidence})${output.trim() === "" ? "; no child output" : `: ${output.trim()}`}`);
    }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve(error.message); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(rejection === undefined ? undefined : `it left an unhandled promise rejection: ${rejection}`);
      else resolve(`it exited with ${code === null ? `signal ${signal}` : `code ${code}`}${said.trim() === "" ? "" : `: ${said.trim()}`}`);
    });
  });
}

export function runWhenReady(ready: Promise<unknown>, run: () => Promise<void>, fail: (error: unknown) => void): Promise<void> {
  return ready.then(run).catch(fail);
}

export async function finishStartCheck(exit: (code: number) => void): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  console.log("start check: the main process reached its handlers");
  exit(0);
}
