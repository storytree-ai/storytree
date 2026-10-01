// From the checkout root: node --import tsx packages/website/src/refresh-forest.ts
import { fileURLToPath } from "node:url";
import { refreshForestFromLibrary } from "@storytree/forest/snapshot";

await refreshForestFromLibrary(fileURLToPath(new URL("./forest-snapshot.json", import.meta.url)));
console.log("Saved public forest drawing. Recapture the still before publishing.");
