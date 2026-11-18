// Capability 2 · Settings
import { VerbRefusal } from "@storytree/library/verbs";

import { storytreeHome } from "../routing/index.js";
import { SERVICE_NAME, setServiceOn } from "./settings.js";

export function switchService(service: string, state: string, home: string = storytreeHome()): readonly string[] {
  if (!SERVICE_NAME.test(service)) throw new VerbRefusal(`a service is named <part>/<service>, such as voice/listen, not ${JSON.stringify(service)}`, { misuse: true });
  if (state !== "on" && state !== "off") throw new VerbRefusal(`a service is turned on or off, not ${JSON.stringify(state)}`, { misuse: true });
  return setServiceOn(service, state === "on", home);
}

export function servicesSaid(on: readonly string[]): string {
  const said = on.length === 0 ? "No service is turned on on this computer." : `Turned on on this computer: ${on.join(", ")}.`;
  return `${said}\nThe service host takes it within seconds; \`storytree services\` lists how each service stands.`;
}
