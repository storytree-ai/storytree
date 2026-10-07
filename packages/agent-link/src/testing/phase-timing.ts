/** Temporary: phase timings for increment_f5a993f5abd4's Windows profile. Never lands. */
import { performance } from "node:perf_hooks";

export async function timed<T>(phase: string, body: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await body();
  } finally {
    console.error(`PHASE ${phase} ${(performance.now() - start).toFixed(1)}`);
  }
}

// Time every child process started synchronously or asynchronously, named by its command and first argument.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const cp = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
for (const name of ["execFileSync", "spawnSync", "execSync"]) {
  const original = cp[name]!;
  cp[name] = function (this: unknown, ...args: unknown[]) {
    const start = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      const command = String(args[0]).split(/[\\/]/).pop();
      const first = Array.isArray(args[1]) ? String(args[1][0]) : "";
      console.error(`PHASE spawn:${name}:${command}:${first} ${(performance.now() - start).toFixed(1)}`);
    }
  };
}
for (const name of ["spawn", "execFile"]) {
  const original = cp[name]!;
  cp[name] = function (this: unknown, ...args: unknown[]) {
    const command = String(args[0]).split(/[\\/]/).pop();
    const first = Array.isArray(args[1]) ? String(args[1][0]) : "";
    console.error(`PHASE async:${name}:${command}:${first} 0`);
    return original.apply(this, args);
  };
}
syncBuiltinESMExports();
