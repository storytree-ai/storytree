/** Start the voice door from its environment (contract 1.11): a bad setting is one stderr line and exit code 1. */
import { ConfigError, loadConfig, type VoiceConfig } from "../config.js";
import { startDoor } from "../door.js";

let config: VoiceConfig;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(`voice door refused to start: ${error.message}\n`);
  process.exit(1);
}

try {
  const door = await startDoor(config);
  const stop = () => {
    process.stdout.write(`${new Date().toISOString()} stopping\n`);
    setTimeout(() => process.exit(0), 2_000).unref();
    void door.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch (error) {
  process.stderr.write(`voice door could not listen on 127.0.0.1:${config.port}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}\n`);
  process.exit(1);
}
