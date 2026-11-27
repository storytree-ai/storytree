// Capability 16 · Commands protocol
import type { Library, Storytree } from "../index.js";
import { verb as protocolVerb, type VerbContext as ProtocolContext, type Verb as ProtocolVerb, type VerbFamilies as ProtocolFamilies, type VerbFamily as ProtocolFamily, type VerbInputs, type VerbPlace } from "../verbs/verb.js";

export { consumersOf, fieldValue, judgedByLines, mounted, VerbRefusal } from "../verbs/verb.js";
export type { Absent, Consumer, DoorWords, InputOf, Step, VerbAnswer, VerbInput, VerbInputs, VerbPlace, VerbValue } from "../verbs/verb.js";
export { WHERE_INPUTS, whereOf, writtenLibrary } from "../project/shared/where.js";
export type { WhereNamed } from "../project/shared/where.js";

export type VerbContext = ProtocolContext<Library, Pick<Storytree, "ownDatabase">>;

export type Verb<I extends VerbInputs = VerbInputs, C extends VerbPlace = VerbContext> = ProtocolVerb<I, C>;

export type VerbFamilies<C extends VerbPlace = VerbContext> = ProtocolFamilies<C>;

export type VerbFamily<C extends VerbPlace = VerbContext> = ProtocolFamily<C>;

export function verb<I extends VerbInputs, C extends VerbPlace = VerbContext>(declared: Verb<I, C>): Verb<VerbInputs, C> {
  return protocolVerb(declared);
}
