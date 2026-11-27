// Capability 17 · The library's commands
import { VerbRefusal } from "./verb.js";

export function refusalOf(error: unknown): unknown {
  if (error instanceof VerbRefusal || !(error instanceof Error) || typeof (error as { code?: unknown }).code === "string") return error;
  return new VerbRefusal(error.message);
}

export async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw refusalOf(error);
  }
}
