// Capability 28 · Shared server
export { addressServer, connectionString, serverOf, type ConnectOptions } from "./address.js";
export {
  cannotCreateDatabases,
  cannotSetUpProject,
  ConnectionError,
  isInsufficientPrivilege,
  isUnreachable,
  LIBRARY_UNREACHABLE,
  outageSaidOnce,
  saysUnreachable,
  sqlState,
  type ConnectionProblem,
  type OutageSaidOnce,
} from "./connection-error.js";
export { fenceOutsideWriter, fenceProject, type OutsideWriter } from "./outside-writer.js";
export { asReader, giveBackReads, nameReader, processReaderName, readerName, scriptReader, takeReads, type ReadTotal } from "./reads.js";
export { CONNECT_TIMEOUT_MS, createDatabase, explainConnectTimeout, localServer, type Server, type ServerOptions } from "./server.js";
export { proxyFor } from "./websocket.js";
