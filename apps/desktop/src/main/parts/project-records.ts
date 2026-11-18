// Capability 8 · Page bridge
import type { ProjectRecords } from "@storytree/app-setup/project";
import { composeParts } from "@storytree/plugin-loader";

export default await composeParts<ProjectRecords>(import.meta.url, "projectRecords");
