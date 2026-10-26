/** Capability 1 · The address and its guards: start the voice door from its environment; a bad setting is one stderr line and exit code 1 (contract 1.11). */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig, type VoiceConfig } from "../config.js";
import { startDoor, type Door } from "../door.js";

export interface Io {
  readonly stderr: (line: string) => void;
  readonly exit: (code: number) => void;
}

const processIo: Io = { stderr: (line) => process.stderr.write(line), exit: (code) => process.exit(code) };

/** The door started from `env`, or undefined once it has refused to start and exited 1. */
export async function main(env: NodeJS.ProcessEnv, io: Io = processIo): Promise<Door | undefined> {
  let config: VoiceConfig;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    io.stderr(`voice door refused to start: ${error.message}\n`);
    io.exit(1);
    return undefined;
  }
  try {
    return await startDoor(config);
  } catch (error) {
    io.stderr(`voice door could not listen on 127.0.0.1:${config.port}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}\n`);
    io.exit(1);
    return undefined;
  }
}

function isEntry(): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  const door = await main(process.env);
  if (door !== undefined) {
    const stop = () => {
      process.stdout.write(`${new Date().toISOString()} stopping\n`);
      setTimeout(() => process.exit(0), 2_000).unref();
      void door.close().then(() => process.exit(0));
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  }
}
