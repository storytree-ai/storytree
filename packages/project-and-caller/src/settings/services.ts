/**
 * Capability 2 · Settings, contract 2.25: `settings set service <part>/<service> on|off` and the services `settings show`
 * lists (ADR-1180 D2). A part's declared service runs on this computer only while it is turned on here, so the part switch
 * alone never starts a service on a machine that should not run it; the service host reads the setting as it runs.
 */
import { VerbRefusal } from "@storytree/library/verbs";

import { storytreeHome } from "../routing/index.js";
import { SERVICE_NAME, setServiceOn } from "./settings.js";

/** Turn `service` on or off for this computer, and return the services now on. A name not `<part>/<service>`, or a state but on or off, is refused, saving nothing. */
export function switchService(service: string, state: string, home: string = storytreeHome()): readonly string[] {
  if (!SERVICE_NAME.test(service)) throw new VerbRefusal(`a service is named <part>/<service>, such as voice/listen, not ${JSON.stringify(service)}`, { misuse: true });
  if (state !== "on" && state !== "off") throw new VerbRefusal(`a service is turned on or off, not ${JSON.stringify(state)}`, { misuse: true });
  return setServiceOn(service, state === "on", home);
}

/** The services turned on on this computer, and when the service host takes a change. */
export function servicesSaid(on: readonly string[]): string {
  const said = on.length === 0 ? "No service is turned on on this computer." : `Turned on on this computer: ${on.join(", ")}.`;
  return `${said}\nThe service host takes it within seconds; \`storytree services\` lists how each service stands.`;
}
