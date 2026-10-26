/**
 * Capability 1 · Lifecycle. The records the stories keep for a project outside its library (code review's QA ledger,
 * ADR-1170 D2), as `#parts/projectRecords` names them run unbundled: composed from the manifests of this app's
 * dependencies by the plugin loader (ADR-1021), for the setup help's Delete to forget with a project. The app's bundle
 * gets the same list from the loader's build plugin instead (build.mjs).
 */
import type { ProjectRecords } from "@storytree/app-setup/project";
import { composeParts } from "@storytree/plugin-loader";

export default await composeParts<ProjectRecords>(import.meta.url, "projectRecords");
