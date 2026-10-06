import { createIdentityClient, type ClientConfiguration } from "./client.js";
import { withSessionStore } from "./session-store.js";

/** CLI-owned formatting and flow live with identity; the command-line story only parses and delegates. */
export async function identityCommand(command: "sign-in" | "status" | "sign-out", options: Omit<ClientConfiguration, "store"> & {
  readonly directory: string;
  readonly signal?: AbortSignal;
  out(text: string): void;
}): Promise<string> {
  return withSessionStore(options, async store => {
    const client = createIdentityClient({ ...options, store });
    if (command === "sign-out") {
      await client.signOut();
      return "Signed out on this computer. Your browser's sign-in is unchanged.";
    }
    const user = command === "sign-in"
      ? await client.signIn(prompt => options.out(`Open ${prompt.verificationUri}\nConfirm code: ${prompt.userCode}\nUse Google, GitHub or Microsoft. You may be asked once to confirm your email.\nSign-in is optional; Storytree works without an account.`), options.signal)
      : await client.status();
    return user ? `Signed in as ${user.email}\nStorytree user: ${user.id}` : "Signed out. Storytree works without an account.";
  });
}
